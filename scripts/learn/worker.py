"""Mäter geo-arbetarens egna raster (fuktdjup med markandel, vegetationsklasser) mot facit: kärr, gult och grönt.
Körs: python3 worker.py <mapp med rutor> <ruta> [<ruta> …]; den nya körningens raster ligger i <ruta>/v12."""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as ndi
base=sys.argv[1]; os.chdir(base)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feats import features
def truth(d):
    """Facit och mätområde direkt ur klassrastret, för rutor utan laserraster i lärmappen (provkartan)."""
    L=np.array(Image.open(f'{d}/labels.png')).astype(int); R,G,B=L[...,0],L[...,1],L[...,2]
    drawn=(R>0)|(G>0)|(B>0)
    ext=ndi.binary_erosion(ndi.binary_fill_holes(ndi.binary_dilation(drawn,iterations=40)),iterations=40)
    dom=ext&~ndi.binary_dilation(np.isin(R,[11,12,13,14]),iterations=3)
    return dict(marsh=(G&16)>0,diffuse=(G&32)>0,green=np.isin(R,[5,6,7]),allopen=np.isin(R,[1,2,3,4])),dom
def score(pred,truth,dom,tol=3):
    p=pred&dom; t=truth&dom
    nt=ndi.binary_dilation(t,iterations=tol)&dom; np_=ndi.binary_dilation(p,iterations=tol)&dom
    P=(p&nt).sum()/max(1,p.sum()); R=(t&np_).sum()/max(1,t.sum()); return P,R,2*P*R/(P+R+1e-9),p.sum()/max(1,t.sum())
def clean(m,minc=25):
    m=ndi.binary_opening(m,iterations=1); lab,n=ndi.label(m)
    if n==0: return m
    size=ndi.sum(m,lab,range(1,n+1)); return np.isin(lab,1+np.nonzero(size>=minc)[0])
def fit(a,shape,dx=0):
    out=np.zeros(shape+a.shape[2:],dtype=a.dtype); a=a[:,dx:]; h=min(shape[0],a.shape[0]); w=min(shape[1],a.shape[1]); out[:h,:w]=a[:h,:w]; return out
for d in sys.argv[2:]:
    if os.path.exists(f'{d}/lasveg.png'): F,Y,dom=features(d)
    else: Y,dom=truth(d)
    shape=dom.shape
    f=fit(np.array(Image.open(f'{d}/v12/fuktdjup.png')).astype(int),shape,dx=1)
    dom=dom&(f[...,3]>0)
    c=fit(np.array(Image.open(f'{d}/v12/vegetationsklasser.png')).astype(int),shape)
    ok=f[...,3]>0; hand=f[...,0]*0.02; share=f[...,1]/254; slope=f[...,2]*0.1; kp=c[...,0]&15
    rows={'kärr förr (HAND ≤ 0,3, lutning ≤ 3°)':('marsh',ok&(hand<=0.3)&(slope<=3)),
          'kärr v12 (+ markandel < 0,8)':('marsh',ok&(hand<=0.3)&(slope<=3)&(share<0.8)),
          'gult v12 (klass 1)':('allopen',(c[...,3]>0)&(kp==1)),
          'grönt v12 (klass ≥ 4)':('green',(c[...,3]>0)&(kp>=4))}
    for name,(t,m) in rows.items():
        P,R,f1,ratio=score(clean(m),(Y['marsh']|Y['diffuse']) if t=='marsh' else Y[t],dom); print(f'{d} {name:40s} P {P:.2f} R {R:.2f} F {f1:.2f} yta×{ratio:.1f}')
