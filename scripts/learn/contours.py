import numpy as np, warnings; warnings.filterwarnings('ignore')
from PIL import Image
from scipy import ndimage as ndi
from feats import features, fillnan
from load import load
S=np.ones((3,3))
for d in 'AB':
    F,Y,dom=features(d); r=load(d); z=ndi.gaussian_filter(fillnan(r['z']),0.7)
    ours=np.array(Image.open(f'{d}/ours.png')).astype(int); theirs=r['labels']
    drawn=(ours[...,0]>0)|(ours[...,1]>0)|(ours[...,2]>0)
    ext=ndi.binary_erosion(ndi.binary_fill_holes(ndi.binary_dilation(drawn,iterations=30)),iterations=34)
    area=dom&ext; km2=area.sum()*4/1e6
    print(f'== Ruta {d}: jämförd yta {km2:.2f} km²')
    for name,L in (('Högdalen',theirs),('O-Tid',ours)):
        G=L[...,1]&15; B=L[...,2]; out=[]
        for v,lab,iv,off in ((1,'kurva',5,0),(2,'stödkurva',25,0),(3,'hjälpkurva',5,2.5)):
            m=(G==v)&area
            comp,n=ndi.label(m,structure=S); sizes=ndi.sum(m,comp,range(1,n+1)) if n else np.array([])
            zz=z[m]; dev=np.abs(((zz-off+2.5)%5)-2.5) if v!=2 else np.abs(((zz+2.5)%5)-2.5)
            sl=F['slope'][m]
            out.append(f'{lab}: {m.sum()*2.2/1000/km2:5.1f} km/km², {n/km2:5.0f} bitar/km², medianbit {np.median(sizes)*2.2 if n else 0:4.0f} m, korta (<60 m) {np.mean(sizes<27)*100 if n else 0:3.0f} %, höjdavvikelse median {np.median(dev):.2f} m (90 %: {np.percentile(dev,90):.2f}), lutning median {np.median(sl):4.1f}°')
        print(' ',name); [print('    ',o) for o in out]
        k=(np.isin(B,[1,2]))&area; ys,xs=np.nonzero(k)
        # kullens höjd över omgivningen 16 m bort
        ring=ndi.maximum_filter(z,3)-ndi.percentile_filter(z,50,footprint=np.ones((17,17)))
        slk=F['slope'][k]
        # närmaste kurva
        dist=ndi.distance_transform_edt(~((G>=1)&(G<=3)))*2
        print(f'     punkthöjder: {k.sum()/km2:4.0f} per km² (avlånga {np.mean(B[k]==2)*100:.0f} %), höjd över omgivningen median {np.median(ring[k]):.1f} m (10–90 %: {np.percentile(ring[k],10):.1f}–{np.percentile(ring[k],90):.1f}), avstånd till närmaste kurva median {np.median(dist[k]):.0f} m, lutning runt {np.median(F["slopemean10"][k]):.1f}°')
        print(f'     gropar: {((B==3)&area).sum()/km2:.0f} per km²; branter: {(((G==4)|(G==5))&area).sum()*2.2/1000/km2:.1f} km/km² (opasserbara {((G==4)&area).sum()/max(1,(((G==4)|(G==5))&area).sum())*100:.0f} %)')
    # var hjälpkurvor ritas: andel av ytan per lutningsklass som har hjälpkurva inom 10 m
    for name,L in (('Högdalen',theirs),('O-Tid',ours)):
        near=ndi.binary_dilation((L[...,1]&15)==3,iterations=5)
        row=[]
        for lo,hi in ((0,3),(3,6),(6,10),(10,20),(20,90)):
            m=area&(F['slopemean10']>=lo)&(F['slopemean10']<hi); row.append(f'{lo}–{hi}°: {near[m].mean()*100:3.0f} %')
        print(f'  hjälpkurva inom 10 m, efter lutning, {name}:',', '.join(row))
