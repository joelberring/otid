"""Facit-svit: en karta = labels (training_labels, cell c, hörn E0,N0) + laserraster (världsfil = mitt på övre vänstra bildpunkten)."""
import numpy as np, json
from PIL import Image
from scipy import ndimage as ndi
Image.MAX_IMAGE_PIXELS=None
MAPS={
 "hogdalen":dict(dir="/home/claude/ortho/hog",labels_cell=1,E0=674559,N0=6572155,world={"lasveg":(674560,6572154),"lasmark":(674560,6572154),"laskron":(674560,6572154),"fuktdjup":(674560,6572154)}),
 "tyresta":dict(dir="/home/claude/ortho/tyr",npz=True,labels_cell=1,E0=687325,N0=6566692,world={k:(687325,6566692) for k in ["lasveg","lasmark","laskron","fuktdjup"]}),
 "lida":dict(dir="lida",labels_cell=2,E0=663200,N0=6563200,world={"lasveg":(663200,6563199),"lasmark":(663200,6563199),"laskron":(663200,6563199),"fuktdjup":(663200,6563200)}),
 "djurgarden":dict(dir="djur",labels_cell=2,E0=676000,N0=6583200,world={"lasveg":(676001,6583200),"lasmark":(676001,6583200),"laskron":(676001,6583200),"fuktdjup":(676000,6583200)}),
 "gommaren":dict(dir="gom",labels_cell=2,E0=664004,N0=6572704,world={"lasveg":(664005,6572703),"lasmark":(664005,6572703),"laskron":(664005,6572703),"fuktdjup":(664004,6572704)}),
}
CLASSES=["vit skog","öppet","grönt","berg","sank","bebyggt","vatten"]
def load(name):
    m=MAPS[name]; d=m["dir"]
    if m.get("npz"): L=np.load(f"{d}/data.npz")["L"]
    else: L=np.array(Image.open(f"{d}/labels.png").convert("RGB")).astype(int)
    c=m["labels_cell"]
    if c==1: L=L[::2,::2]   # till 2 m (cellmitt ≈ +0,5 m)
    H,W=L.shape[:2]
    rr,cc=np.mgrid[0:H,0:W]; E=m["E0"]+cc*2+1; N=m["N0"]-rr*2-1
    R={}
    for n,(x0,y0) in m["world"].items():
        a=np.array(Image.open(f"{d}/{n}.png").convert("RGBA")).astype(np.float32)
        col=np.round((E-x0)/2).astype(int); row=np.round((y0-N)/2).astype(int)
        ok=(col>=0)&(col<a.shape[1])&(row>=0)&(row<a.shape[0])
        v=np.full((H,W,4),np.nan,np.float32); v[ok]=a[row[ok],col[ok]]; v[v[...,3]==0]=np.nan; R[n]=v
    F={"vegh":R["lasveg"][...,0]*0.2,"ground":R["lasveg"][...,1]/255,"mid":R["lasveg"][...,2]/255,
       "low":R["lasmark"][...,0]/255,"inten":R["lasmark"][...,1],"spread":np.where(R["lasmark"][...,2]<255,R["lasmark"][...,2],np.nan),
       "high":R["laskron"][...,0]/255,"npts":R["laskron"][...,1],
       "wet":R["fuktdjup"][...,0]*0.02,"slope":np.where(R["fuktdjup"][...,2]<255,R["fuktdjup"][...,2]*0.1,np.nan)}
    for k in ["vegh","mid","low","high","ground"]:
        a=np.nan_to_num(F[k]); F[k+"_m5"]=ndi.uniform_filter(a,5); F[k+"_m11"]=ndi.uniform_filter(a,11)
    F["wet_min5"]=ndi.minimum_filter(np.nan_to_num(F["wet"],nan=9),5)
    g=L[...,0]; lb=L[...,1] if L.shape[2]>1 else np.zeros_like(g)
    y=np.full(g.shape,-1)
    y[g==0]=0; y[np.isin(g,[1,2,3,4])]=1; y[np.isin(g,[5,6,7])]=2; y[g==8]=3
    if name!="tyresta": y[(lb&48)>0]=4
    y[np.isin(g,[11,12,13])]=5; y[g==14]=6; y[g==9]=5
    valid=(y>=0)&~np.isnan(F["vegh"])&~np.isnan(F["wet"])
    return F,y,valid
