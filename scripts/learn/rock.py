"""Berg i dagen mot facit: python3 rock.py <datamapp> <ruta> <minE> <maxN> <mapp med <ruta>.rock.json>. Även: vad O-Tids
vegetationsklass säger där kartan har berg i dagen."""
import sys, json, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
base,d,minE,maxN,out=sys.argv[1],sys.argv[2],float(sys.argv[3]),float(sys.argv[4]),sys.argv[5]
L=np.array(Image.open(f'{base}/{d}/labels.png')).astype(int); H,W=L.shape[:2]
img=Image.new('L',(W,H),0); dr=ImageDraw.Draw(img)
for ring in json.load(open(f'{out}/{d}.rock.json')): dr.polygon([((x-minE)/2,(maxN-y)/2) for x,y in ring],fill=1)
p=np.array(img)>0; t=L[...,0]==8
drawn=(L[...,0]>0)|(L[...,1]>0)|(L[...,2]>0)
dom=ndi.binary_erosion(ndi.binary_fill_holes(ndi.binary_dilation(drawn,iterations=40)),iterations=40)&~ndi.binary_dilation(np.isin(L[...,0],[11,12,13,14]),iterations=3)
p&=dom; t&=dom; nt=ndi.binary_dilation(t,iterations=3); npd=ndi.binary_dilation(p,iterations=3)
P=(p&nt).sum()/max(1,p.sum()); R=(t&npd).sum()/max(1,t.sum())
print(d,'berg i dagen: träffsäkerhet %.2f, hittat %.2f, F %.2f, yta ×%.2f (kartans berg: %.1f ha)'%(P,R,2*P*R/(P+R+1e-9),p.sum()/max(1,t.sum()),t.sum()*4/1e4))
c=np.array(Image.open(f'{base}/{d}/v12/vegetationsklasser.png')).astype(int); c=c[:H,:W,0]&15; tt=t[:c.shape[0],:c.shape[1]]
if tt.sum(): print(d,'O-Tids klass där kartan har berg: öppet %.0f %%, skog %.0f %%, grönt %.0f %%'%(100*(c[tt]==1).mean(),100*np.isin(c[tt],[2,3]).mean(),100*(c[tt]>=4).mean()))
# vad kartan har där O-Tid säger öppet
o=(c==1)&dom[:c.shape[0],:c.shape[1]]; R0=L[:c.shape[0],:c.shape[1],0]
if o.sum(): print(d,'kartan där O-Tid säger öppet: gult %.0f %%, berg %.0f %%, skog (vitt) %.0f %%, grönt %.0f %%'%tuple(100*m[o].mean() for m in (np.isin(R0,[1,2,3,4,9]),R0==8,R0==0,np.isin(R0,[5,6,7]))))
