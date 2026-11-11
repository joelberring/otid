"""Läser en rutas raster till gemensamt 2 m-rutnät (rad 0 = norr). Ursprung: A (674371, 6572340), B (674183, 6574570)."""
from PIL import Image; import numpy as np
from scipy import ndimage as ndi
def load(d):
    im=lambda n: np.array(Image.open(f'{d}/{n}.png')).astype(np.int64)
    L=im('labels'); H,W=L.shape[:2]
    h=im('hojd'); z=(h[...,0]*65536+h[...,1]*256+h[...,2]-10000)/100.0; z[h[...,3]==0]=np.nan
    hh,ww=(z.shape[0]//2)*2,(z.shape[1]//2)*2
    with np.errstate(all='ignore'): z2=np.nanmean(z[:hh,:ww].reshape(hh//2,2,ww//2,2),axis=(1,3))
    def fit(a,dx=0,dy=0,fill=0):
        out=np.full((H,W)+a.shape[2:],fill,dtype=a.dtype if fill==0 else float)
        a=a[dy:,dx:]; h_=min(H,a.shape[0]); w_=min(W,a.shape[1]); out[:h_,:w_]=a[:h_,:w_]; return out
    z2=fit(z2,fill=np.nan)
    f=im('fuktdjup'); f=fit(f,dx=1)   # fuktdjupets rutnät börjar 2 m väster om de andra
    v=fit(im('lasveg')); m=fit(im('lasmark')); k=fit(im('laskron')); c=fit(im('vegetationsklasser'))
    ok=(v[...,3]>0)&~np.isnan(z2)
    return dict(labels=L,z=z2,ok=ok,
        hand=np.where(f[...,3]>0,f[...,0]*0.02,np.nan), slope=np.where((f[...,3]>0)&(f[...,2]<255),f[...,2]*0.1,np.nan),
        vegh=v[...,0]*0.2, ground=v[...,1]/255, mid=v[...,2]/255, low=m[...,0]/255, inten=m[...,1]*64.0, spread=np.where(m[...,2]<255,m[...,2]/100,np.nan),
        high=k[...,0]/255, n=k[...,1], kp=c[...,0]&15, kpund=c[...,0]>>4)
