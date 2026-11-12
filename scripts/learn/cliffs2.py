"""Branter ur lutningsrastret mot facit (2026-11-12): kör i datamappen; load(ruta), lines(r, fall, lutning), score(linjer, facit, område)."""
import numpy as np, sys, warnings; warnings.filterwarnings('ignore')
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize, remove_small_objects
Image.MAX_IMAGE_PIXELS=None
def z1(d):
    h=np.array(Image.open(f'{d}/hojd.png')).astype(np.int64); z=(h[...,0]*65536+h[...,1]*256+h[...,2]-10000)/100.0; z[h[...,3]==0]=np.nan; return z
def load(d):
    z=z1(d); zf=np.where(np.isnan(z),np.nanmedian(z),z)
    L=np.array(Image.open(f'{d}/labels.png')).astype(int); H,W=min(z.shape[0],L.shape[0]*2),min(z.shape[1],L.shape[1]*2)
    up=lambda a: np.kron(a,np.ones((2,2),dtype=a.dtype))[:H,:W]
    R,G=L[...,0],L[...,1]&15
    drawn=(L[...,0]>0)|(L[...,1]>0)|(L[...,2]>0)
    dom=ndi.binary_erosion(ndi.binary_fill_holes(ndi.binary_dilation(drawn,iterations=40)),iterations=40)&~ndi.binary_dilation(np.isin(R,[11,12,13,14]),iterations=4)
    zf=zf[:H,:W]
    gy,gx=np.gradient(ndi.gaussian_filter(zf,0.7)); sl=np.degrees(np.arctan(np.hypot(gx,gy)))
    r=dict(z=zf,sl=sl,dom=up(dom.astype(np.uint8))>0,cliff=up(((G==4)|(G==5)).astype(np.uint8))>0,imp=up((G==4).astype(np.uint8))>0,
           drop5=ndi.maximum_filter(zf,5)-ndi.minimum_filter(zf,5),drop7=ndi.maximum_filter(zf,7)-ndi.minimum_filter(zf,7))
    try:
        O=np.array(Image.open(f'{d}/ours.png')).astype(int); r['ours']=up((np.isin(O[...,1]&15,[4,5])).astype(np.uint8))>0
    except Exception: pass
    return r
def lines(r,D,S,minlen=6,key='drop7'):
    m=(r[key]>=D)&(r['sl']>=S)
    m=ndi.binary_closing(m,iterations=1)
    sk=skeletonize(m); sk=remove_small_objects(sk,minlen,connectivity=2); return sk
def score(p,t,dom,tol=8):
    p=p&dom; t=t&dom; nt=ndi.binary_dilation(t,iterations=tol); npd=ndi.binary_dilation(p,iterations=tol)
    P=(p&nt).sum()/max(1,p.sum()); R=(t&npd).sum()/max(1,t.sum())
    # längd: kartans linje är 2 celler bred efter uppskalning från 2 m, vår är 1 cell
    return P,R,2*P*R/(P+R+1e-9),p.sum()/max(1,skeletonize(t).sum())
