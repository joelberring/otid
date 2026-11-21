import numpy as np, suite
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import f1_score
D={n:suite.load(n) for n in suite.MAPS}
KEYS=[k for k in D["hogdalen"][0]]
rng=np.random.default_rng(0)
def rule(F):
    p=np.zeros(F["vegh"].shape,int)
    p[F["mid_m5"]>0.12]=2
    p[(np.nan_to_num(F["high"],nan=1)<0.05)&(np.nan_to_num(F["vegh"],nan=9)<1.5)]=1
    return p
res={}
for weight in (None,"balanced"):
  print("vikt",weight)
  for test in D:
    F,y,v=D[test]; v=v&np.isin(y,[0,1,2,3])
    yy=np.where(y==3,1,y)
    Xs=[];ys=[]
    for tr in D:
        if tr==test: continue
        Ft,yt,vt=D[tr]; vt=vt&np.isin(yt,[0,1,2,3]); idx=np.flatnonzero(vt.ravel()); idx=rng.choice(idx,min(len(idx),150000),replace=False)
        Xs.append(np.stack([Ft[k].ravel()[idx] for k in KEYS],1)); ys.append(np.where(yt.ravel()[idx]==3,1,yt.ravel()[idx]))
    X=np.concatenate(Xs); Y=np.concatenate(ys)
    sw=None
    if weight: 
        cnt=np.bincount(Y,minlength=3); sw=(1/np.maximum(cnt,1))[Y]**0.5
    m=HistGradientBoostingClassifier(max_iter=200,random_state=0).fit(X,Y,sample_weight=sw)
    p=m.predict(np.stack([F[k][v] for k in KEYS],1))
    r=f1_score(yy[v],rule(F)[v],average=None,labels=[0,1,2]); mm=f1_score(yy[v],p,average=None,labels=[0,1,2])
    print(f"  {test:11s} regel {r.round(2)}  modell {mm.round(2)}")
