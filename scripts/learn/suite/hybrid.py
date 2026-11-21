import numpy as np, suite, pickle
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import f1_score
D={n:suite.load(n) for n in suite.MAPS}
KEYS=["vegh","ground","mid","low","inten","spread","high","npts","wet","slope","vegh_m5","mid_m5","low_m5","high_m5","ground_m5","vegh_m11","mid_m11","low_m11","high_m11","ground_m11"]
rng=np.random.default_rng(0)
def openrule(F): return (np.nan_to_num(F["high"],nan=1)<0.05)&(np.nan_to_num(F["vegh"],nan=9)<1.5)
def sample(names):
    Xs=[];ys=[]
    for tr in names:
        Ft,yt,vt=D[tr]; vt=vt&np.isin(yt,[0,2])&~openrule(Ft); idx=np.flatnonzero(vt.ravel()); idx=rng.choice(idx,min(len(idx),150000),replace=False)
        Xs.append(np.stack([Ft[k].ravel()[idx] for k in KEYS],1)); ys.append((yt.ravel()[idx]==2).astype(int))
    return np.concatenate(Xs),np.concatenate(ys)
tot={"regel":[],"hybrid":[]}
for test in D:
    F,y,v=D[test]; v=v&np.isin(y,[0,1,2,3]); yy=np.where(y==3,1,y)
    X,Y=sample([n for n in D if n!=test]); w=np.where(Y==1,(Y==0).sum()/max(Y.sum(),1),1)**0.5
    m=HistGradientBoostingClassifier(max_iter=200,random_state=0).fit(X,Y,sample_weight=w)
    op=openrule(F)
    prob=np.zeros(F["vegh"].shape); prob[v]=m.predict_proba(np.stack([F[k][v] for k in KEYS],1))[:,1]
    rule=np.where(op,1,np.where(F["mid_m5"]>0.12,2,0))
    best=None
    for t in (0.5,0.6,0.7):
        hyb=np.where(op,1,np.where(prob>t,2,0))
        f=f1_score(yy[v],hyb[v],average=None,labels=[0,1,2])
        print(f"  {test:11s} t={t} hybrid {f.round(2)}", end="")
        if t==0.6: tot["hybrid"].append(f)
    r=f1_score(yy[v],rule[v],average=None,labels=[0,1,2]); tot["regel"].append(r); print("  regel",r.round(2))
for k,v in tot.items(): print(k,"medel",np.mean(v,0).round(3))
X,Y=sample(list(D)); w=np.where(Y==1,(Y==0).sum()/max(Y.sum(),1),1)**0.5
m=HistGradientBoostingClassifier(max_iter=200,random_state=0).fit(X,Y,sample_weight=w)
pickle.dump((KEYS,m),open("green_model.pkl","wb"))
