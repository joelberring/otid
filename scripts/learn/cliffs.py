import numpy as np, warnings; warnings.filterwarnings('ignore')
from PIL import Image
from scipy import ndimage as ndi
from load import load
from feats import features
def z1(d):
    h=np.array(Image.open(f'{d}/hojd.png')).astype(np.int64); z=(h[...,0]*65536+h[...,1]*256+h[...,2]-10000)/100.0; z[h[...,3]==0]=np.nan; return z
for d in 'AB':
    z=z1(d); zf=np.where(np.isnan(z),np.nanmedian(z),z)
    # fallhöjd inom 3 m (7×7 m fönster) och brantaste lutning i 1 m-rastret
    drop=ndi.maximum_filter(zf,7)-ndi.minimum_filter(zf,7)
    gy,gx=np.gradient(ndi.gaussian_filter(zf,0.7)); sl=np.degrees(np.arctan(np.hypot(gx,gy)))
    L=load(d)['labels']; G=L[...,1]&15; F,Y,dom=features(d)
    up=lambda a: np.kron(a,np.ones((2,2),dtype=a.dtype))[:z.shape[0],:z.shape[1]]
    def at(mask):  # störst värde inom 5 m från kartans linje (kartan ligger några meter fel)
        m=up(mask.astype(np.uint8)); H,W=m.shape
        dmax=ndi.maximum_filter(drop,11)[:H,:W][m[:H,:W]>0]; smax=ndi.maximum_filter(sl,11)[:H,:W][m[:H,:W]>0]; return dmax,smax
    domu=up(dom)>0
    for v,name in ((4,'opasserbar brant'),(5,'brant')):
        dr,s=at(G==v); print(f'{d} {name}: fallhöjd inom 3 m (bäst inom 5 m): 10 % {np.percentile(dr,10):.1f}, median {np.median(dr):.1f}, 90 % {np.percentile(dr,90):.1f} m; lutning median {np.median(s):.0f}°, 10 % {np.percentile(s,10):.0f}°')
    # hur mycket av terrängen över olika trösklar som har en ritad brant inom 8 m
    near=up(ndi.binary_dilation((G==4)|(G==5),iterations=4))>0
    H,W=near.shape
    for th in (1.0,1.5,2.0,3.0,4.0):
        m=(drop[:H,:W]>=th)&domu[:H,:W]; print(f'   fallhöjd ≥ {th} m: {m.mean()*100:.1f} % av ytan, varav ritad brant inom 8 m: {near[m].mean()*100:.0f} %')
