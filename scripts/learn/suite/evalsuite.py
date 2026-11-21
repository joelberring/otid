import numpy as np, suite, sys, json
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import f1_score
D={n:suite.load(n) for n in suite.MAPS}
KEYS=[k for k in D["hogdalen"][0]]
def rules(F):
    p=np.zeros(F["vegh"].shape,int)
    high=np.nan_to_num(F["high"],nan=1); vegh=np.nan_to_num(F["vegh"],nan=9)
    p[(F["mid_m5"]>0.12)]=2
    p[(high<0.05)&(vegh<1.5)]=1
    p[(np.nan_to_num(F["wet"],nan=9)<0.25)&(np.nan_to_num(F["slope"],nan=9)<3)]=4
    p[(np.nan_to_num(F["npts"])==0)]=5
    return p
def f1s(y,p): return f1_score(y,p,average=None,labels=range(7),zero_division=0)
out={"regler":{},"modell":{}}
rng=np.random.default_rng(0)
for test in D:
    F,y,v=D[test]
    out["regler"][test]=f1s(y[v],rules(F)[v]).round(2).tolist()
    Xs=[];ys=[]
    for tr in D:
        if tr==test: continue
        Ft,yt,vt=D[tr]; idx=np.flatnonzero(vt.ravel()); idx=rng.choice(idx,min(len(idx),150000),replace=False)
        Xs.append(np.stack([Ft[k].ravel()[idx] for k in KEYS],1)); ys.append(yt.ravel()[idx])
    m=HistGradientBoostingClassifier(max_iter=200,class_weight="balanced",random_state=0).fit(np.concatenate(Xs),np.concatenate(ys))
    X=np.stack([F[k][v] for k in KEYS],1)
    out["modell"][test]=f1s(y[v],m.predict(X)).round(2).tolist()
print("klass:",suite.CLASSES)
for k in out:
    for t,r in out[k].items(): print(f"{k:7s} {t:11s}", r)
json.dump(out,open("baseline.json","w"))
