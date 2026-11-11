import numpy as np, warnings; warnings.filterwarnings('ignore')
from scipy import ndimage as ndi
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.tree import DecisionTreeClassifier, export_text
from feats import features
from rules import score
D={d:features(d) for d in 'AB'}
FE=['area','slope','hand','sink','tpi30','tpi60','rim','rimshare','vegh','ground','low','mid','inten','rough','compact','open']
def candidates(F,dom,slope=3.0,hand=1.5):
    m=(F['slopemean10']<=slope)&(F['hand']<=hand)&dom
    m=ndi.binary_opening(m,structure=np.ones((3,3)),iterations=2)
    lab,n=ndi.label(m); return lab,n
def objfeats(F,lab,n):
    idx=np.arange(1,n+1); mean=lambda a: ndi.mean(a,lab,idx)
    area=ndi.sum(np.ones_like(lab),lab,idx)*4.0
    z=F['z'] if 'z' in F else None
    X={'area':area,'slope':mean(F['slope']),'hand':mean(F['hand']),'sink':mean(F['sink']),'tpi30':mean(F['tpi30']),'tpi60':mean(F['tpi60']),
       'vegh':mean(F['vegh']),'ground':mean(F['ground']),'low':mean(F['low']),'mid':mean(F['mid']),'inten':mean(F['inten']),'rough':mean(F['rough']),'open':mean(F['openshare'])}
    # kanten: ringen 10 m utanför objektet; hur mycket högre den ligger och hur stor del av den som stiger minst 0,5 m
    rim=np.zeros(n); share=np.zeros(n); comp=np.zeros(n)
    sl=ndi.find_objects(lab)
    for i,s in enumerate(sl):
        if s is None: continue
        y0,y1=max(0,s[0].start-6),s[0].stop+6; x0,x1=max(0,s[1].start-6),s[1].stop+6
        o=lab[y0:y1,x0:x1]==i+1; ring=ndi.binary_dilation(o,iterations=5)&~o
        zz=F['zs'][y0:y1,x0:x1]; inside=zz[o].mean()
        if ring.sum()==0: continue
        rim[i]=zz[ring].mean()-inside; share[i]=(zz[ring]>inside+0.5).mean()
        per=(o&~ndi.binary_erosion(o)).sum(); comp[i]=4*np.pi*o.sum()/max(1,per)**2
    X['rim']=rim; X['rimshare']=share; X['compact']=comp
    return np.stack([X[k] for k in FE],1)
OBJ={}
for d in 'AB':
    F,Y,dom=D[d]
    from feats import fillnan
    from load import load
    F['zs']=ndi.gaussian_filter(fillnan(load(d)['z']),1)
    lab,n=candidates(F,dom); X=objfeats(F,lab,n)
    truth=Y['marsh']|Y['diffuse']
    ov=ndi.mean(truth.astype(float),lab,np.arange(1,n+1))
    OBJ[d]=(lab,n,X,ov>=0.25,truth,dom)
    P,R,f,ratio=score(lab>0,truth,dom); print(d,'kandidater',n,'kärrobjekt',int((ov>=0.25).sum()),f'alla kandidater: P {P:.2f} R {R:.2f} yta×{ratio:.1f}')
for tr,te in (('A','B'),('B','A')):
    lab,n,X,y,truth,dom=OBJ[tr]; labt,nt,Xt,yt,trutht,domt=OBJ[te]
    m=HistGradientBoostingClassifier(max_iter=80,max_leaf_nodes=6,learning_rate=0.1,class_weight='balanced',random_state=0).fit(X,y,sample_weight=X[:,0])
    p=m.predict_proba(Xt)[:,1]
    for th in (0.3,0.5,0.7):
        keep=np.concatenate([[False],p>=th]); pred=keep[labt]
        P,R,f,ratio=score(pred,trutht,domt); print(f' modell {tr}->{te} tröskel {th}: P {P:.2f} R {R:.2f} F {f:.2f} yta×{ratio:.1f}')
    t=DecisionTreeClassifier(max_depth=3,min_samples_leaf=8,class_weight='balanced',random_state=0).fit(X,y,sample_weight=X[:,0])
    keep=np.concatenate([[False],t.predict(Xt)]); P,R,f,ratio=score(keep[labt],trutht,domt)
    print(f' träd {tr}->{te}: P {P:.2f} R {R:.2f} F {f:.2f} yta×{ratio:.1f}'); print(export_text(t,feature_names=FE,decimals=2))
