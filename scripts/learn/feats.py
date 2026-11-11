import numpy as np
from scipy import ndimage as ndi
from load import load
import warnings; warnings.filterwarnings('ignore')
def fillnan(z):
    m=np.isnan(z); idx=ndi.distance_transform_edt(m,return_distances=False,return_indices=True); return z[tuple(idx)]
def mean(a,r): return ndi.uniform_filter(a,2*r+1,mode='nearest')
def features(d):
    r=load(d); L=r['labels']; R,G,B=L[...,0],L[...,1],L[...,2]
    z=fillnan(r['z']); zs=ndi.gaussian_filter(z,1)
    F={}
    gy,gx=np.gradient(zs,2.0); F['slope']=np.degrees(np.arctan(np.hypot(gx,gy)))
    for rad in (3,8,15,30): F[f'tpi{rad*2}']=zs-mean(zs,rad)          # läge mot omgivningen (m), radie i meter
    for rad in (5,15): F[f'slopemean{rad*2}']=mean(F['slope'],rad)
    F['rough']=np.sqrt(np.maximum(0,mean((z-mean(z,1))**2,2)))
    # sänkans djup: fyll upp till lägsta kanten (enkelt: morfologisk rekonstruktion uppifrån)
    from skimage.morphology import reconstruction
    seed=z.copy(); seed[1:-1,1:-1]=z.max(); F['sink']=reconstruction(seed,z,method='erosion')-z
    F['hand']=fillnan(r['hand']); F['slopelas']=fillnan(r['slope'])
    for k in ('vegh','ground','mid','low','high','inten','n'): F[k]=r[k].astype(float)
    F['spread']=fillnan(r['spread'])
    F['veghmean']=mean(F['vegh'],2); F['groundmean']=mean(F['ground'],2); F['intenmean']=mean(F['inten'],2); F['lowmean']=mean(F['low'],2); F['midmean']=mean(F['mid'],2)
    F['openshare']=mean((F['vegh']<1.5).astype(float),3)
    F['kp']=r['kp'].astype(float)
    # kartans utbredning: allt ritat, vidgat 80 m, hål fyllda, krympt tillbaka
    drawn=(R>0)|(G>0)|(B>0)
    ext=ndi.binary_erosion(ndi.binary_fill_holes(ndi.binary_dilation(drawn,iterations=40)),iterations=40)
    built=np.isin(R,[11,12,13,14,9])|((G&15)==8)
    dom=ext&r['ok']&~ndi.binary_dilation(np.isin(R,[11,12,13,14]),iterations=3)
    Y=dict(marsh=(G&16)>0, diffuse=(G&32)>0, rock=R==8, green=np.isin(R,[5,6,7]), g1=R==5,g2=R==6,g3=R==7, rough_open=np.isin(R,[1,2]), open=np.isin(R,[3,4]), allopen=np.isin(R,[1,2,3,4]),
           knoll=np.isin(B,[1,2]), boulder=np.isin(B,[4,5,6]), stony=B==7, smallmarsh=B==8, und=(G&192)>0)
    return F,Y,dom
