"""Kurvor och punkthöjder mot facit ur höjdrastret: python3 terrain.py <datamapp> <ruta> <minE> <maxN> [<ut-mapp för kullprovet>].
Höjdkurvor: laserns 5 m-kurvor (bästa nivåförskjutning) mot kartans 101–102 med 6 m tolerans. Hjälpkurvor: hur stor del av
alla halvkurvor kartritaren har ritat. Skriver också markrastret och facitpunkterna för kullprovet (knolls.ts)."""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage as ndi
Image.MAX_IMAGE_PIXELS=None
base,d,minE,maxN=sys.argv[1],sys.argv[2],float(sys.argv[3]),float(sys.argv[4]); out=sys.argv[5] if len(sys.argv)>5 else None
h=np.array(Image.open(f'{base}/{d}/hojd.png')).astype(np.int64)
z=((h[...,0]*65536+h[...,1]*256+h[...,2]-10000)/100.0).astype(np.float32); z[h[...,3]==0]=np.nan
H,W=z.shape
L=np.array(Image.open(f'{base}/{d}/labels.png')).astype(int)
built=ndi.binary_dilation(np.isin(L[...,0],[11,12,13,14]),iterations=3)
drawn=(L[...,0]>0)|(L[...,1]>0)|(L[...,2]>0)
ext=ndi.binary_erosion(ndi.binary_fill_holes(ndi.binary_dilation(drawn,iterations=40)),iterations=40)&~built
if out:
    np.ascontiguousarray(z[::-1,:].T).tofile(f'{out}/{d}.f32')
    pts=[]
    for code in (1,2):
        m=L[...,2]==code; lab,n=ndi.label(m)
        for (r,c) in ndi.center_of_mass(m,lab,range(1,n+1)): pts.append([code,minE+c*2+1,maxN-r*2-1])
    Image.fromarray((ext*255).astype(np.uint8)).save(f'{out}/{d}.dom.png')
    json.dump(dict(width=W,height=H,minX=minE,minY=maxN-H,pts=pts,lw=L.shape[1],lh=L.shape[0],maxN=maxN),open(f'{out}/{d}.json','w'))
hh,ww=(H//2)*2,(W//2)*2
with np.errstate(all='ignore'): z2=np.nanmean(z[:hh,:ww].reshape(hh//2,2,ww//2,2),axis=(1,3))
z2=z2[:L.shape[0],:L.shape[1]]; Lc=L[:z2.shape[0],:z2.shape[1]]; dom=ext[:z2.shape[0],:z2.shape[1]]&~np.isnan(z2)
zs=ndi.gaussian_filter(np.nan_to_num(z2,nan=0),1.0)
def lines(off):
    k=np.floor((zs-off)/5); e=np.zeros_like(k,bool); e[:-1,:]|=k[:-1,:]!=k[1:,:]; e[:,:-1]|=k[:,:-1]!=k[:,1:]; return e
def sc(p,t,tol=3):
    p=p&dom;t=t&dom; nt=ndi.binary_dilation(t,iterations=tol); npd=ndi.binary_dilation(p,iterations=tol)
    return (p&nt).sum()/max(1,p.sum()),(t&npd).sum()/max(1,t.sum()),p.sum()/max(1,t.sum())
code=Lc[...,1]&15; cont=np.isin(code,[1,2]); form=code==3
best=max(((off,)+sc(lines(off),cont) for off in np.arange(0,5,0.5)),key=lambda r:r[1]+r[2])
print(d,'höjdkurvor: nivå +%.1f m, laserns nära kartans %.2f, kartans nära laserns %.2f, mängd ×%.2f'%best)
P,R,ratio=sc(lines(best[0]+2.5),form)
print(d,'hjälpkurvor: kartritaren har ritat %.0f %% av halvkurvorna; %.0f %% av kartans hjälpkurvor ligger på halvnivå'%(100*P,100*R))
k=(Lc[...,2]==1)&dom; e=(Lc[...,2]==2)&dom
print(d,'punkthöjder i facit: %d runda, %d avlånga'%(ndi.label(k)[1],ndi.label(e)[1]))
