//! Shared binary morphology, 256-byte LUT Zhang–Suen thinning, and O(C) linear skeleton
//! path tracing (exact clean-room Rust port of `scripts/geo-cliffs.ts` `close`, `thin`, `paths`
//! and `scripts/geo-tracks.ts` `closeMask`).

use std::sync::OnceLock;

struct ThinLuts {
    pass0: [u8; 256],
    pass1: [u8; 256],
    corner: [u8; 256],
}

static LUTS: OnceLock<ThinLuts> = OnceLock::new();

fn luts() -> &'static ThinLuts {
    LUTS.get_or_init(|| {
        let mut pass0 = [0u8; 256];
        let mut pass1 = [0u8; 256];
        let mut corner = [0u8; 256];
        let rx: [i8; 8] = [0, 1, 1, 1, 0, -1, -1, -1];
        let ry: [i8; 8] = [1, 1, 0, -1, -1, -1, 0, 1];
        for m in 0..256usize {
            let mut count = 0u32;
            let mut trans = 0u32;
            for k in 0..8 {
                let a = (m >> k) & 1;
                let b = (m >> ((k + 1) & 7)) & 1;
                count += a as u32;
                if a == 0 && b == 1 {
                    trans += 1;
                }
            }
            let n = m & 1;
            let ne = (m >> 1) & 1;
            let e = (m >> 2) & 1;
            let se = (m >> 3) & 1;
            let s = (m >> 4) & 1;
            let sw = (m >> 5) & 1;
            let w = (m >> 6) & 1;
            let nw = (m >> 7) & 1;
            if (2..=6).contains(&count) && trans == 1 {
                if n * e * s == 0 && e * s * w == 0 {
                    pass0[m] = 1;
                }
                if n * e * w == 0 && n * s * w == 0 {
                    pass1[m] = 1;
                }
            }
            if count >= 2
                && !(n != 0 && e != 0 && s != 0 && w != 0)
                && ((n != 0 && e != 0 && sw == 0)
                    || (e != 0 && s != 0 && nw == 0)
                    || (s != 0 && w != 0 && ne == 0)
                    || (w != 0 && n != 0 && se == 0))
            {
                let mut bits = [0usize; 8];
                let mut nb = 0usize;
                for k in 0..8 {
                    if ((m >> k) & 1) != 0 {
                        bits[nb] = k;
                        nb += 1;
                    }
                }
                let mut vis = [false; 8];
                let mut q = [0usize; 8];
                let mut qlen = 1usize;
                q[0] = bits[0];
                vis[bits[0]] = true;
                let mut h = 0usize;
                while h < qlen {
                    let cur = q[h];
                    h += 1;
                    for &b in &bits[..nb] {
                        if !vis[b] && (rx[cur] - rx[b]).abs() <= 1 && (ry[cur] - ry[b]).abs() <= 1 {
                            vis[b] = true;
                            q[qlen] = b;
                            qlen += 1;
                        }
                    }
                }
                if qlen == nb {
                    corner[m] = 1;
                }
            }
        }
        ThinLuts { pass0, pass1, corner }
    })
}

/// 4-neighbor 1-cell morphological closing (`scripts/geo-cliffs.ts` `close`).
pub fn close_4(mask: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut grown = vec![0u8; mask.len()];
    let mut out = vec![0u8; mask.len()];
    if width < 3 || height < 3 {
        return out;
    }
    for x in 1..(width - 1) {
        let base = x * height;
        for y in 1..(height - 1) {
            let i = base + y;
            if (mask[i] | mask[i - 1] | mask[i + 1] | mask[i - height] | mask[i + height]) != 0 {
                grown[i] = 1;
            }
        }
    }
    for x in 1..(width - 1) {
        let base = x * height;
        for y in 1..(height - 1) {
            let i = base + y;
            if (grown[i] & grown[i - 1] & grown[i + 1] & grown[i - height] & grown[i + height]) != 0
                || mask[i] != 0
            {
                out[i] = 1;
            }
        }
    }
    out
}

/// 8-neighbor morphological closing by `reach` cells (`scripts/geo-tracks.ts` `closeMask`).
pub fn close_8(mask: &[u8], w: usize, h: usize, reach: usize) -> Vec<u8> {
    if reach == 0 {
        return mask.to_vec();
    }
    let step = |src: &[u8], grow: bool| -> Vec<u8> {
        let mut out = vec![0u8; src.len()];
        for x in 0..w {
            let xi = x as isize;
            for y in 0..h {
                let yi = y as isize;
                let mut any = false;
                let mut all = true;
                for ax in -1..=1isize {
                    let nx = xi + ax;
                    for ay in -1..=1isize {
                        let ny = yi + ay;
                        let v = if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                            src[nx as usize * h + ny as usize]
                        } else {
                            0
                        };
                        if v != 0 {
                            any = true;
                        } else {
                            all = false;
                        }
                    }
                }
                out[x * h + y] = u8::from(if grow { any } else { all });
            }
        }
        out
    };
    let mut cur = mask.to_vec();
    for _ in 0..reach {
        cur = step(&cur, true);
    }
    for _ in 0..reach {
        cur = step(&cur, false);
    }
    cur
}

/// Zhang–Suen active-list thinning with 256-byte LUT (`scripts/geo-cliffs.ts` `thin`).
pub fn thin(mask: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut out = vec![0u8; mask.len()];
    let mut interior = 0usize;
    for x in 0..width {
        let base = x * height;
        let inner_x = x > 0 && x + 1 < width;
        for y in 0..height {
            if mask[base + y] != 0 {
                out[base + y] = 1;
                if inner_x && y > 0 && y + 1 < height {
                    interior += 1;
                }
            }
        }
    }
    if interior == 0 {
        return out;
    }
    let mut active = Vec::<usize>::with_capacity(interior);
    for x in 1..(width - 1) {
        let base = x * height;
        for y in 1..(height - 1) {
            if out[base + y] != 0 {
                active.push(base + y);
            }
        }
    }
    let mut remove = Vec::<usize>::with_capacity(interior);
    let h1 = height + 1;
    let hm1 = height - 1;
    let tbl = luts();
    let mut changed = true;
    while changed && !active.is_empty() {
        changed = false;
        for pass in 0..2 {
            let lut = if pass == 0 { &tbl.pass0 } else { &tbl.pass1 };
            remove.clear();
            for &i in &active {
                let code = (out[i + 1] as usize)
                    | ((out[i + h1] as usize) << 1)
                    | ((out[i + height] as usize) << 2)
                    | ((out[i + hm1] as usize) << 3)
                    | ((out[i - 1] as usize) << 4)
                    | ((out[i - h1] as usize) << 5)
                    | ((out[i - height] as usize) << 6)
                    | ((out[i - hm1] as usize) << 7);
                if lut[code] != 0 {
                    remove.push(i);
                }
            }
            if !remove.is_empty() {
                changed = true;
                for &r in &remove {
                    out[r] = 0;
                }
                active.retain(|&idx| out[idx] != 0);
            }
        }
    }
    out
}

const DIR8_X: [isize; 8] = [-1, -1, -1, 0, 0, 1, 1, 1];
const DIR8_Y: [isize; 8] = [-1, 0, 1, -1, 1, -1, 0, 1];

#[inline]
fn for8(left: &[u8], width: usize, height: usize, i: usize, mut visit: impl FnMut(usize)) {
    let x = (i / height) as isize;
    let y = (i - x as usize * height) as isize;
    let w = width as isize;
    let h = height as isize;
    for d in 0..8 {
        let nx = x + DIR8_X[d];
        let ny = y + DIR8_Y[d];
        if nx >= 0 && ny >= 0 && nx < w && ny < h {
            let n = nx as usize * height + ny as usize;
            if left[n] != 0 {
                visit(n);
            }
        }
    }
}

#[inline]
fn deg_now(left: &[u8], width: usize, height: usize, i: usize) -> usize {
    let mut c = 0usize;
    for8(left, width, height, i, |_| c += 1);
    c
}

#[inline]
fn push_edge(cells: &[usize], rev: bool, dst: &mut Vec<usize>) {
    if !rev {
        dst.extend_from_slice(cells);
    } else {
        dst.extend(cells.iter().rev().copied());
    }
}

/// Linear O(C) skeleton graph path tracing (exact match to `scripts/geo-cliffs.ts` `paths`).
pub fn paths(
    skeleton: &[u8],
    width: usize,
    height: usize,
    min_cells: usize,
    max_cells: usize,
) -> Vec<Vec<usize>> {
    let size = width * height;
    let mut left = skeleton.to_vec();
    let mut out = Vec::<Vec<usize>>::new();
    let mut from = vec![-2i32; size];
    let mut queue = vec![0usize; size];
    let mut node_id = vec![-1i32; size];
    let mut chain_seen = vec![0u8; size];
    let h1 = height + 1;
    let hm1 = height.saturating_sub(1);
    let corner_lut = &luts().corner;

    let bfs_farthest = |seed: usize,
                        left: &[u8],
                        from: &mut [i32],
                        queue: &mut [usize]|
     -> (usize, Vec<usize>, usize) {
        from[seed] = -1;
        queue[0] = seed;
        let mut head = 0usize;
        let mut tail = 1usize;
        while head < tail {
            let i = queue[head];
            head += 1;
            for8(left, width, height, i, |n| {
                if from[n] == -2 {
                    from[n] = i as i32;
                    queue[tail] = n;
                    tail += 1;
                }
            });
        }
        let end = queue[tail - 1];
        let mut path = Vec::new();
        let mut cur = end as i32;
        while cur >= 0 {
            path.push(cur as usize);
            cur = from[cur as usize];
        }
        for &idx in &queue[..tail] {
            from[idx] = -2;
        }
        (end, path, tail)
    };

    for start in 0..size {
        if left[start] == 0 {
            continue;
        }
        let (first_end_node, _, first_seen) = bfs_farthest(start, &left, &mut from, &mut queue);
        if first_seen > max_cells || first_seen < min_cells {
            for &idx in &queue[..first_seen] {
                left[idx] = 0;
            }
            continue;
        }
        let mut max_deg = 0usize;
        let mut first_end: Option<usize> = None;
        let mut deg_sum = 0usize;
        for &p in &queue[..first_seen] {
            let d = deg_now(&left, width, height, p);
            deg_sum += d;
            if d > max_deg {
                max_deg = d;
            }
            if d == 1 && first_end.is_none() {
                first_end = Some(p);
            }
        }
        if max_deg <= 2 {
            let mut seq = Vec::with_capacity(first_seen);
            let mut cur = first_end.unwrap_or(queue[0]);
            let mut prev = usize::MAX;
            for step in 0..first_seen {
                seq.push(cur);
                let mut nxt = usize::MAX;
                let seq0 = seq[0];
                for8(&left, width, height, cur, |n| {
                    if n != prev && !(step > 0 && n == seq0) && nxt == usize::MAX {
                        nxt = n;
                    }
                });
                if nxt == usize::MAX {
                    break;
                }
                prev = cur;
                cur = nxt;
            }
            if first_end.is_some() || first_seen == 1 {
                if seq.len() >= min_cells {
                    out.push(seq);
                }
            } else {
                let half = seq.len() / 2;
                if half + 1 >= min_cells {
                    out.push(seq[..=half].to_vec());
                }
                if seq.len() - half - 1 >= min_cells {
                    out.push(seq[(half + 1)..].to_vec());
                }
            }
            for &idx in &queue[..first_seen] {
                left[idx] = 0;
            }
            continue;
        }

        if deg_sum / 2 == first_seen - 1 || first_seen > 2000 {
            let prune_corners = first_seen > 2000;
            if prune_corners {
                for &i in &queue[..first_seen] {
                    let x = i / height;
                    let y = i - x * height;
                    if x < 1 || y < 1 || x + 1 >= width || y + 1 >= height || left[i] == 0 {
                        continue;
                    }
                    let code = (left[i + 1] as usize)
                        | ((left[i + h1] as usize) << 1)
                        | ((left[i + height] as usize) << 2)
                        | ((left[i + hm1] as usize) << 3)
                        | ((left[i - 1] as usize) << 4)
                        | ((left[i - h1] as usize) << 5)
                        | ((left[i - height] as usize) << 6)
                        | ((left[i - hm1] as usize) << 7);
                    if corner_lut[code] != 0 {
                        left[i] = 0;
                    }
                }
            }
            let mut node_pixel = Vec::<usize>::new();
            for &p in &queue[..first_seen] {
                if left[p] != 0 && deg_now(&left, width, height, p) != 2 {
                    node_id[p] = node_pixel.len() as i32;
                    node_pixel.push(p);
                }
            }
            let nv = node_pixel.len();
            let mut edge_u = Vec::<usize>::new();
            let mut edge_v = Vec::<usize>::new();
            let mut edge_len = Vec::<usize>::new();
            let mut edge_cells = Vec::<Vec<usize>>::new();
            let mut adj = vec![Vec::<usize>::new(); nv];

            for v in 0..nv {
                let p = node_pixel[v];
                let mut nbrs = Vec::<usize>::with_capacity(8);
                for8(&left, width, height, p, |n| nbrs.push(n));
                for n in nbrs {
                    let w = node_id[n];
                    if w >= 0 {
                        let wu = w as usize;
                        if v < wu {
                            let eid = edge_u.len();
                            edge_u.push(v);
                            edge_v.push(wu);
                            edge_len.push(1);
                            edge_cells.push(Vec::new());
                            adj[v].push(eid);
                            adj[wu].push(eid);
                        }
                    } else if chain_seen[n] == 0 {
                        let mut cells = Vec::new();
                        let mut prev = p;
                        let mut cur = n;
                        while node_id[cur] < 0 {
                            chain_seen[cur] = 1;
                            cells.push(cur);
                            let mut nxt = usize::MAX;
                            for8(&left, width, height, cur, |cand| {
                                if cand != prev && nxt == usize::MAX {
                                    nxt = cand;
                                }
                            });
                            if nxt == usize::MAX {
                                break;
                            }
                            prev = cur;
                            cur = nxt;
                        }
                        let end_w = node_id[cur];
                        if end_w >= 0 {
                            let ew = end_w as usize;
                            let eid = edge_u.len();
                            edge_u.push(v);
                            edge_v.push(ew);
                            edge_len.push(cells.len() + 1);
                            edge_cells.push(cells);
                            adj[v].push(eid);
                            if ew != v {
                                adj[ew].push(eid);
                            }
                        }
                    }
                }
            }

            let ne = edge_u.len();
            let mut comp_paths = Vec::<Vec<usize>>::new();
            if nv > 0 && ne == nv - 1 {
                let tree_bfs = |root: usize| -> (usize, Vec<i32>, Vec<i32>, Vec<usize>) {
                    let mut dist = vec![-1i32; nv];
                    let mut par_n = vec![-1i32; nv];
                    let mut par_e = vec![-1i32; nv];
                    let mut ord = Vec::<usize>::with_capacity(nv);
                    let mut far = root;
                    let mut far_d = 0i32;
                    dist[root] = 0;
                    ord.push(root);
                    let mut oh = 0;
                    while oh < ord.len() {
                        let u = ord[oh];
                        oh += 1;
                        let du = dist[u];
                        if du > far_d {
                            far_d = du;
                            far = u;
                        }
                        for &eid in &adj[u] {
                            let to = if edge_u[eid] == u { edge_v[eid] } else { edge_u[eid] };
                            if dist[to] == -1 {
                                dist[to] = du + edge_len[eid] as i32;
                                par_n[to] = u as i32;
                                par_e[to] = eid as i32;
                                ord.push(to);
                            }
                        }
                    }
                    (far, par_n, par_e, ord)
                };
                let (root, _, _, _) = tree_bfs(0);
                let (_, par_n, par_e, ord) = tree_bfs(root);
                let mut children = vec![Vec::<usize>::new(); nv];
                let mut child_edge = vec![Vec::<usize>::new(); nv];
                for &u in &ord {
                    let par = par_n[u];
                    if par >= 0 {
                        children[par as usize].push(u);
                        child_edge[par as usize].push(par_e[u] as usize);
                    }
                }
                let mut best_down = vec![0usize; nv];
                let mut best_c = vec![-1i32; nv];
                let mut best_e = vec![-1i32; nv];
                for &u in ord.iter().rev() {
                    for j in 0..children[u].len() {
                        let ch = children[u][j];
                        let ce = child_edge[u][j];
                        let l = edge_len[ce] + best_down[ch];
                        if l > best_down[u] {
                            best_down[u] = l;
                            best_c[u] = ch as i32;
                            best_e[u] = ce as i32;
                        }
                    }
                }
                let mut pending = vec![(root, usize::MAX, usize::MAX)];
                let mut pi = 0usize;
                while pi < pending.len() {
                    let (r, fr, edge) = pending[pi];
                    pi += 1;
                    let mut path = Vec::new();
                    if edge != usize::MAX {
                        push_edge(&edge_cells[edge], edge_u[edge] != fr, &mut path);
                    }
                    path.push(node_pixel[r]);
                    let mut cur = r;
                    loop {
                        let bc = best_c[cur];
                        for j in 0..children[cur].len() {
                            if children[cur][j] as i32 != bc {
                                pending.push((children[cur][j], cur, child_edge[cur][j]));
                            }
                        }
                        if bc < 0 {
                            break;
                        }
                        let eid = best_e[cur] as usize;
                        push_edge(&edge_cells[eid], edge_u[eid] != cur, &mut path);
                        path.push(node_pixel[bc as usize]);
                        cur = bc as usize;
                    }
                    if path.len() >= min_cells {
                        comp_paths.push(path);
                    }
                }
            } else if ne > 0 {
                let mut order: Vec<usize> = (0..ne).collect();
                order.sort_by(|&a, &b| edge_len[b].cmp(&edge_len[a]));
                let mut used_edge = vec![0u8; ne];
                let mut used_node = vec![0u8; nv];
                let extend = |from_node: usize,
                              dst: &mut Vec<usize>,
                              used_edge: &mut [u8],
                              used_node: &mut [u8]| {
                    let mut cur = from_node;
                    while used_node[cur] == 0 {
                        used_node[cur] = 1;
                        let mut best_eid = usize::MAX;
                        let mut best_l = 0usize;
                        for &eid in &adj[cur] {
                            if used_edge[eid] == 0 && (best_eid == usize::MAX || edge_len[eid] > best_l) {
                                best_l = edge_len[eid];
                                best_eid = eid;
                            }
                        }
                        if best_eid == usize::MAX {
                            break;
                        }
                        used_edge[best_eid] = 1;
                        let nxt = if edge_u[best_eid] == cur { edge_v[best_eid] } else { edge_u[best_eid] };
                        push_edge(&edge_cells[best_eid], edge_u[best_eid] != cur, dst);
                        if used_node[nxt] == 0 {
                            dst.push(node_pixel[nxt]);
                        }
                        cur = nxt;
                    }
                };
                for eid in order {
                    if used_edge[eid] != 0 {
                        continue;
                    }
                    used_edge[eid] = 1;
                    let u = edge_u[eid];
                    let v = edge_v[eid];
                    let mut back = Vec::new();
                    let mut fwd = Vec::new();
                    if used_node[u] == 0 {
                        back.push(node_pixel[u]);
                        extend(u, &mut back, &mut used_edge, &mut used_node);
                    }
                    back.reverse();
                    push_edge(&edge_cells[eid], false, &mut back);
                    if used_node[v] == 0 {
                        fwd.push(node_pixel[v]);
                        extend(v, &mut fwd, &mut used_edge, &mut used_node);
                    }
                    back.extend_from_slice(&fwd);
                    if back.len() >= min_cells {
                        comp_paths.push(back);
                    }
                }
            }
            comp_paths.sort_by(|a, b| b.len().cmp(&a.len()));
            out.extend(comp_paths);
            for &p in &queue[..first_seen] {
                left[p] = 0;
                node_id[p] = -1;
                chain_seen[p] = 0;
            }
            continue;
        }

        let mut end = first_end_node;
        while left[start] != 0 {
            let (_, longest_path, longest_seen) = bfs_farthest(end, &left, &mut from, &mut queue);
            if longest_path.len() < min_cells {
                for &idx in &queue[..longest_seen] {
                    left[idx] = 0;
                }
                break;
            }
            for &i in &longest_path {
                left[i] = 0;
            }
            for &i in &longest_path {
                let mut nbrs = [0usize; 8];
                let mut ncnt = 0usize;
                for8(&left, width, height, i, |n| {
                    nbrs[ncnt] = n;
                    ncnt += 1;
                });
                for &n in &nbrs[..ncnt] {
                    if deg_now(&left, width, height, n) <= 1 {
                        left[n] = 0;
                    }
                }
            }
            out.push(longest_path);
            if left[start] == 0 {
                break;
            }
            let (again_end, _, again_seen) = bfs_farthest(start, &left, &mut from, &mut queue);
            if again_seen < min_cells {
                for &idx in &queue[..again_seen] {
                    left[idx] = 0;
                }
                break;
            }
            end = again_end;
        }
    }
    out
}
