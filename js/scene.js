import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/three/addons/environments/RoomEnvironment.js';
import { sampleMotion } from './motion.js?v=20';

export const CAMERA_YAW = Math.atan2(4.6, 10.2);
export function screenToTray(x,y) {
  return {x:Math.cos(CAMERA_YAW)*x+Math.sin(CAMERA_YAW)*y,z:-Math.sin(CAMERA_YAW)*x+Math.cos(CAMERA_YAW)*y};
}
function roundedRect(x0,x1,z0,z1,r) {
  const s=new THREE.Shape(),y0=-z1,y1=-z0;
  s.moveTo(x0+r,y0);s.lineTo(x1-r,y0);s.quadraticCurveTo(x1,y0,x1,y0+r);
  s.lineTo(x1,y1-r);s.quadraticCurveTo(x1,y1,x1-r,y1);
  s.lineTo(x0+r,y1);s.quadraticCurveTo(x0,y1,x0,y1-r);
  s.lineTo(x0,y0+r);s.quadraticCurveTo(x0,y0,x0+r,y0);return s;
}
function extrude(shape,depth,bevel=.055) {
  const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:7,steps:1,curveSegments:24});
  g.rotateX(-Math.PI/2);g.computeVertexNormals();return g;
}
function barrierShape(barrier) {
  const pts=barrier.points,r=barrier.radius-.055;
  const side=sign=>pts.map((p,i)=>{const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);return {x:p.x-sign*dz/l*r,z:p.z+sign*dx/l*r};});
  const left=side(1),right=side(-1).reverse(),s=new THREE.Shape();s.moveTo(left[0].x,-left[0].z);
  for(const p of left.slice(1))s.lineTo(p.x,-p.z);
  function cap(end,neighbor,from,to){
    const dx=end.x-neighbor.x,dz=end.z-neighbor.z,l=Math.hypot(dx,dz),tx=dx/l*r,tz=dz/l*r;
    s.quadraticCurveTo(from.x+tx,-from.z-tz,end.x+tx,-end.z-tz);
    s.quadraticCurveTo(to.x+tx,-to.z-tz,to.x,-to.z);
  }
  cap(pts.at(-1),pts.at(-2),left.at(-1),right[0]);
  for(const p of right.slice(1))s.lineTo(p.x,-p.z);
  cap(pts[0],pts[1],right.at(-1),left[0]);s.closePath();return s;
}
function radialShadow() {
  const c=document.createElement('canvas');c.width=c.height=256;
  const ctx=c.getContext('2d'),g=ctx.createRadialGradient(128,128,18,128,128,125);
  g.addColorStop(0,'rgba(23,31,49,.44)');g.addColorStop(.45,'rgba(23,31,49,.19)');g.addColorStop(1,'rgba(23,31,49,0)');ctx.fillStyle=g;ctx.fillRect(0,0,256,256);return new THREE.CanvasTexture(c);
}
export function createScene(canvas,layout,profileElement) {
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xe9edf2,0);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.VSMShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.97;
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-7,7,7,-7,.1,100);
  camera.position.set(4.6,12.4,10.8);camera.lookAt(0,0,.6);
  const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
  const environment=pmrem.fromScene(room,.03);scene.environment=environment.texture;scene.environmentIntensity=.65;room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe7efff,0x777c8c,.65));
  const key=new THREE.DirectionalLight(0xfff5e6,3.5);key.position.set(-5.5,8,4.5);key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-6,right:6,top:7,bottom:-6,near:.1,far:30});
  key.shadow.normalBias=.025;key.shadow.bias=-.00015;key.shadow.radius=6;key.shadow.blurSamples=12;scene.add(key);
  const fill=new THREE.DirectionalLight(0xaebfff,.6);fill.position.set(6,5,-5);scene.add(fill);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.ShadowMaterial({opacity:.19}));floor.rotation.x=-Math.PI/2;floor.position.y=-.72;floor.receiveShadow=true;scene.add(floor);
  const shadowMap=radialShadow();
  const contact=new THREE.Mesh(new THREE.PlaneGeometry(9,10),new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false,opacity:.7}));contact.rotation.x=-Math.PI/2;contact.position.set(.3,-.715,.7);scene.add(contact);
  const tray=new THREE.Group();tray.position.y=.08;scene.add(tray);
  const pearl=new THREE.MeshPhysicalMaterial({color:0xd9dbd9,roughness:.28,metalness:.23,clearcoat:.4,clearcoatRoughness:.3});
  const surface=new THREE.MeshPhysicalMaterial({color:0xdadde0,roughness:.56,metalness:.08});
  const chrome=new THREE.MeshPhysicalMaterial({color:0xdde4ee,metalness:1,roughness:.13,envMapIntensity:2.0,clearcoat:.6});
  const blue=new THREE.MeshPhysicalMaterial({color:0x1539cd,roughness:.28,metalness:.4,clearcoat:.6});
  const dark=new THREE.MeshStandardMaterial({color:0x27364d,metalness:.65,roughness:.36});
  const sharedMaterials=new Set([pearl,surface,chrome,blue,dark]);
  function mesh(geometry,material,x=0,y=0,z=0,shadows=true,parent=tray){const o=new THREE.Mesh(geometry,material);o.position.set(x,y,z);o.castShadow=shadows;o.receiveShadow=shadows;parent.add(o);return o;}
  let currentLayout=layout,course,ring,startMark,movingParts=[];
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let lightTime=0;

  // A restrained translucent perimeter exposes an actual circuit shelf. The
  // pearl playfield and the integrated, screwless nameplate remain quiet.
  const caseShape=()=>roundedRect(-3.42,3.42,-3.42,4.48,.87);
  const opening=()=>roundedRect(-layout.half-.065,layout.half+.065,-layout.half-.065,layout.half+.065,layout.corner+.065);
  const cut=(shape,hole)=>shape.holes.push(new THREE.Path(hole.getPoints(36).reverse()));
  const chassisMaterial=new THREE.MeshPhysicalMaterial({color:0x29383e,metalness:.48,roughness:.42});
  mesh(extrude(caseShape(),.13,.055),chassisMaterial,0,-.48);
  const pcbShape=roundedRect(-3.34,3.34,-3.34,4.39,.80);cut(pcbShape,opening());
  const pcbMaterial=new THREE.MeshPhysicalMaterial({color:0x075d32,roughness:.54,metalness:.12,clearcoat:.25,clearcoatRoughness:.42});
  mesh(extrude(pcbShape,.035,.008),pcbMaterial,0,-.27);

  const copperMaterial=new THREE.MeshStandardMaterial({color:0xb39354,roughness:.43,metalness:.74});
  const pinMaterial=new THREE.MeshStandardMaterial({color:0xc8d0cb,roughness:.3,metalness:.9});
  const chipMaterial=new THREE.MeshStandardMaterial({color:0x101615,roughness:.72,metalness:.12});
  const chipBodies=[],pins=[],capacitors=[],solderPads=[],orientationDots=[];
  // Each section has a molded IC, bent leads, and its own bypass capacitor.
  // The same local pin coordinates drive the metal pads and the copper routes.
  // u points toward the outer board edge; t runs along the package.
  const chips=[[-3.15,-1.23,.43,-1,5],[-3.15,1.49,.37,-1,5],[3.15,-1.58,.45,1,5],[3.15,.73,.38,1,5],[-1.88,-3.15,.46,0,6],[1.05,-3.15,.38,0,6]].map(([x,z,length,side,count])=>({
    x,z,length,side,count,
    point:(u,t)=>side?[x+side*u,z+t]:[x+t,z-u],
    along:index=>(index/(count-1)-.5)*length*.72,
  }));
  function part(items,chip,u,t,y,cross,height,along){
    const[x,z]=chip.point(u,t);items.push([x,y,z,chip.side?cross:along,height,chip.side?along:cross]);
  }
  for(const chip of chips){
    part(chipBodies,chip,0,0,-.164,.16,.105,chip.length);
    const[dotX,dotZ]=chip.point(-.043,-chip.length*.32);
    orientationDots.push([dotX,-.108,dotZ,.009,.002,.009]);
    for(let index=0;index<chip.count;index++)for(const side of[-1,1]){
      const t=chip.along(index);
      // Shoulder, downturned leg and soldered toe form a continuous gull wing.
      part(pins,chip,side*.088,t,-.173,.032,.018,.024);
      part(pins,chip,side*.101,t,-.192,.014,.038,.024);
      part(pins,chip,side*.121,t,-.209,.040,.014,.024);
      part(solderPads,chip,side*.121,t,-.220,.052,.007,.034);
    }
    const capT=chip.length/2+.14;
    part(capacitors,chip,.035,capT,-.185,.10,.063,.078);
    for(const side of[-1,1]){
      part(pins,chip,.035+side*.061,capT,-.190,.030,.053,.080);
      part(solderPads,chip,.035+side*.071,capT,-.220,.043,.007,.094);
    }
  }
  function instances(items,material,geometry=new THREE.BoxGeometry(1,1,1)){
    const object=new THREE.InstancedMesh(geometry,material,items.length),transform=new THREE.Object3D();
    items.forEach(([x,y,z,w,h,d],index)=>{transform.position.set(x,y,z);transform.scale.set(w,h,d);transform.updateMatrix();object.setMatrixAt(index,transform.matrix);});
    object.castShadow=true;object.receiveShadow=true;tray.add(object);return object;
  }
  const packageGeometry=extrude(roundedRect(-.5,.5,-.5,.5,.07),1,.035);packageGeometry.translate(0,-.5,0);
  instances(solderPads,copperMaterial);instances(chipBodies,chipMaterial,packageGeometry);instances(pins,pinMaterial);
  instances(capacitors,new THREE.MeshStandardMaterial({color:0xa79470,metalness:.08,roughness:.66}),packageGeometry);
  instances(orientationDots,new THREE.MeshStandardMaterial({color:0x8d9a90,roughness:.8}),new THREE.CylinderGeometry(1,1,1,12));

  // Flat copper sits under solder mask, not above it as decorative round wire.
  // Every visible route ends at a real lead, capacitor pad, test pad or via;
  // the latter continue into the inner signal/ground layers of the board.
  const boardPrint=document.createElement('canvas');boardPrint.width=1536;boardPrint.height=1792;
  const print=boardPrint.getContext('2d'),sx=boardPrint.width/6.68,sz=boardPrint.height/7.73;
  const point=(x,z)=>[(x+3.34)*sx,(z+3.34)*sz];
  const routes=[],vias=[];
  const route=(points,width=.010)=>routes.push({points,width});
  const via=(p,ground=false)=>vias.push({p,ground});
  // The rail follows an inset of the actual rounded board. Short 45-degree
  // notches clear the IC pads; between packages the rail returns farther in.
  // In particular, a single long front diagonal would disappear under the
  // nameplate, so its corners follow the physical board/apron clearance.
  const railEdge=3.285,railFront=4.335,railNotch=.030;
  function railSide(sections,start,end,map){
    const points=[map(start,0)];
    for(const chip of sections){
      const t=chip.side?chip.z:chip.x;
      const from=t-chip.length/2-.060,to=t+chip.length/2+.225;
      points.push(map(from-railNotch,0),map(from,railNotch),map(to,railNotch),map(to+railNotch,0));
    }
    points.push(map(end,0));return points;
  }
  function railCorner(a,control,b){
    // Eight small facets stay inside the board's quadratic corner, with an
    // explicit edge margin rather than relying on the texture being clipped.
    return Array.from({length:8},(_,index)=>{
      const t=(index+1)/8,u=1-t;return[u*u*a[0]+2*u*t*control[0]+t*t*b[0],u*u*a[1]+2*u*t*control[1]+t*t*b[1]];
    });
  }
  const supplyRail=[
    ...railSide(chips.filter(chip=>chip.side===0),-2.54,2.54,(t,n)=>[t,-railEdge-n]),
    ...railCorner([2.54,-railEdge],[railEdge,-railEdge],[railEdge,-2.54]),
    ...railSide(chips.filter(chip=>chip.side===1),-2.54,3.59,(t,n)=>[railEdge+n,t]).slice(1),
    ...railCorner([railEdge,3.59],[railEdge,railFront],[2.54,railFront]),
    [-2.54,railFront],
    ...railCorner([-2.54,railFront],[-railEdge,railFront],[-railEdge,3.59]),
    ...railSide(chips.filter(chip=>chip.side===-1),-2.54,3.59,(t,n)=>[-railEdge-n,t]).reverse().slice(1),
    ...railCorner([-railEdge,-2.54],[-railEdge,-railEdge],[-2.54,-railEdge]),
  ];
  route(supplyRail,.014);
  const linkedPins=new Set();
  for(const [from,to]of[[0,1],[2,3],[4,5]]){
    const a=chips[from],b=chips[to],start=a.along(a.count-1),end=b.along(0);
    // Signals between sections use a clear inner lane and 45-degree pad fan-in.
    route([a.point(-.121,start),a.point(-.105,start+.016),b.point(-.105,end-.016),b.point(-.121,end)]);
    linkedPins.add(from+':'+(a.count-1));linkedPins.add(to+':0');
  }
  chips.forEach((chip,chipIndex)=>{
    const capT=chip.length/2+.14,last=chip.along(chip.count-1);
    // The rail feeds the capacitor pad before the adjacent IC supply lead.
    route([chip.point(.165,capT),chip.point(.106,capT)],.016);
    route([chip.point(.106,capT),chip.point(.145,capT-.039),chip.point(.145,last+.024),chip.point(.121,last)],.014);
    const ground=chip.point(-.075,capT);
    route([chip.point(-.036,capT),ground],.014);via(ground,true);
    for(let index=0;index<chip.count;index++)for(const side of[-1,1]){
      if(side===1&&index===chip.count-1||side===-1&&linkedPins.has(chipIndex+':'+index))continue;
      const t=chip.along(index),end=chip.point(side*.137,t+.030);
      route([chip.point(side*.121,t),chip.point(side*.137,t+.016),end],.009);
      via(end,side===-1&&index===Math.floor(chip.count/2));
    }
  });
  // Two useful test pads replace the former disconnected labels at the front.
  const testPads=[{p:[-.48,4.29],label:'3V3'},{p:[.48,4.29],label:'GND'}];
  route([[-.48,4.29],[-.48,railFront]],.018);
  route([[.48,4.29],[.55,4.29]],.014);via([.55,4.29],true);
  print.fillStyle='rgba(37,103,62,.13)';print.fillRect(0,0,boardPrint.width,boardPrint.height);
  function stroke(points,width,color){
    print.beginPath();points.forEach(([x,z],index)=>{const[pX,pZ]=point(x,z);index?print.lineTo(pX,pZ):print.moveTo(pX,pZ);});
    print.strokeStyle=color;print.lineWidth=width*sx;print.lineCap='round';print.lineJoin='round';print.stroke();
  }
  // A narrow clearance in the ground pour borders each covered copper track.
  for(const {points,width}of routes)stroke(points,width+.020,'rgba(4,55,32,.54)');
  for(const {points,width}of routes)stroke(points,width,'rgba(106,151,87,.68)');
  for(const{p,ground}of vias){
    const[x,z]=point(...p),r=(ground?.012:.010)*sx;
    print.beginPath();print.arc(x,z,r+1.1,0,Math.PI*2);print.fillStyle='#0c502d';print.fill();
    print.beginPath();print.arc(x,z,r,0,Math.PI*2);print.fillStyle='#ac9965';print.fill();
    print.beginPath();print.arc(x,z,r*.43,0,Math.PI*2);print.fillStyle='#183b2c';print.fill();
  }
  print.font='12px monospace';
  function label(p,text){const[x,z]=point(...p);print.fillStyle='rgba(224,231,211,.65)';print.fillText(text,x,z);}
  chips.forEach((chip,index)=>{
    // Silkscreen stops at package ends; it never crosses a solder pad.
    for(const sign of[-1,1])stroke([chip.point(-.068,sign*(chip.length/2+.036)),chip.point(.068,sign*(chip.length/2+.036))],.006,'rgba(224,231,211,.57)');
    label(chip.point(-.065,-chip.length/2-.105),'U'+(index+1));
    label(chip.point(-.015,chip.length/2+.285),'C'+(index+1));
  });
  for(const{p,label:text}of testPads){
    const[x,z]=point(...p);print.beginPath();print.arc(x,z,.025*sx,0,Math.PI*2);print.fillStyle='#b6a36b';print.fill();
    // Print beside the pad, fully beyond the apron instead of under its edge.
    label([p[0]-.15,p[1]+.020],text);
  }
  const boardTexture=new THREE.CanvasTexture(boardPrint);boardTexture.colorSpace=THREE.SRGBColorSpace;boardTexture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  const printGeometry=new THREE.ShapeGeometry(pcbShape,24);printGeometry.rotateX(-Math.PI/2);
  const printPositions=printGeometry.attributes.position,printUV=printGeometry.attributes.uv;
  for(let index=0;index<printPositions.count;index++)printUV.setXY(index,(printPositions.getX(index)+3.34)/6.68,1-(printPositions.getZ(index)+3.34)/7.73);
  mesh(printGeometry,new THREE.MeshBasicMaterial({map:boardTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),0,-.218,0,false);

  // This single hardware indicator precedes the current-role line. Its group
  // follows the paragraph's untransformed layout metrics on desktop and mobile;
  // the optical parts retain their physical size as the text reflows.
  const statusIndicator=new THREE.Group();tray.add(statusIndicator);
  const roleElement=profileElement?.querySelector('p');
  const statusBezel=mesh(new THREE.TorusGeometry(.065,.011,8,32),dark,0,.435,0,false,statusIndicator);statusBezel.rotation.x=-Math.PI/2;
  const statusMaterial=new THREE.MeshPhysicalMaterial({color:0x3f90ff,emissive:0x2385ff,emissiveIntensity:2.35,roughness:.12,metalness:.05,clearcoat:1,toneMapped:false});
  const statusLens=mesh(new THREE.SphereGeometry(.053,24,14),statusMaterial,0,.442,0,false,statusIndicator);statusLens.scale.y=.43;
  mesh(new THREE.CylinderGeometry(.021,.024,.004,24),new THREE.MeshBasicMaterial({color:0xc8e8ff,toneMapped:false}),0,.465,0,false,statusIndicator);
  const statusLight=new THREE.PointLight(0x459bff,.29,.65,2);statusLight.position.set(0,.52,0);statusIndicator.add(statusLight);
  const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=64;
  const glowContext=glowCanvas.getContext('2d'),glowGradient=glowContext.createRadialGradient(32,32,4,32,32,32);
  glowGradient.addColorStop(0,'rgba(40,132,255,.40)');glowGradient.addColorStop(.3,'rgba(40,132,255,.16)');glowGradient.addColorStop(1,'rgba(40,132,255,0)');
  glowContext.fillStyle=glowGradient;glowContext.fillRect(0,0,64,64);
  const statusGlow=mesh(new THREE.PlaneGeometry(.42,.42),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(glowCanvas),transparent:true,depthWrite:false,opacity:.68,toneMapped:false}),0,.429,0,false,statusIndicator);statusGlow.rotation.x=-Math.PI/2;
  function alignStatusWithRole(){
    const localX=roleElement?roleElement.offsetLeft+7:27;
    const localY=roleElement?roleElement.offsetTop+roleElement.offsetHeight/2:75;
    statusIndicator.position.set(-2.63+localX/540*5.26,0,3.19+localY/110);
  }

  const shellShape=caseShape();cut(shellShape,opening());
  cut(shellShape,roundedRect(-2.79,2.79,3.12,4.22,.16));
  const smoke=new THREE.MeshPhysicalMaterial({color:0x82979b,roughness:.12,metalness:0,transparent:true,opacity:.30,transmission:.18,thickness:.32,ior:1.45,clearcoat:1,clearcoatRoughness:.1,depthWrite:false});
  const casing=mesh(extrude(shellShape,.58,.065),smoke,0,-.22,0,false);casing.renderOrder=3;
  // A thin polished perimeter catches light without painting over the internals.
  const seamShape=caseShape();cut(seamShape,roundedRect(-3.385,3.385,-3.385,4.445,.835));
  const seamMaterial=new THREE.MeshPhysicalMaterial({color:0xa5b6bb,metalness:.45,roughness:.25,transparent:true,opacity:.55,depthWrite:false});
  const seam=mesh(extrude(seamShape,.008,.005),seamMaterial,0,-.23,0,false);seam.renderOrder=4;
  mesh(extrude(roundedRect(-2.79,2.79,3.12,4.22,.16),.58,.02),pearl,0,-.185);
  // A satin finish sits just above the apron without a raised rim or hardware.
  const nameplateShape=roundedRect(-2.76,2.76,3.15,4.22,.16);
  const nameplateFinish=new THREE.MeshPhysicalMaterial({color:0xd9dde1,roughness:.48,metalness:.17,clearcoat:.12,clearcoatRoughness:.48});
  mesh(extrude(nameplateShape,.001,.001),nameplateFinish,0,.424,0,false);

  function buildCourse(nextLayout){
    const group=new THREE.Group(),goal=nextLayout.goal,parts=[];
    const add=(geometry,material,x=0,y=0,z=0,shadows=true,parent=group)=>mesh(geometry,material,x,y,z,shadows,parent);
    // All course geometry is made once. A moving goal has a real circular bore
    // in an overlapping slider, above a larger fixed aperture in the deck.
    const baseShape=roundedRect(-2.955,2.955,-2.955,2.955,.705);
    if(goal.motion){
      const travelX=goal.motion.axis==='x'?Math.abs(goal.motion.amplitude):0;
      const travelZ=goal.motion.axis==='z'?Math.abs(goal.motion.amplitude):0;
      const apertureX=goal.radius+travelX+.035,apertureZ=goal.radius+travelZ+.035;
      cut(baseShape,roundedRect(goal.x-apertureX,goal.x+apertureX,goal.z-apertureZ,goal.z+apertureZ,.12));
    }else{
      const hole=new THREE.Path();hole.absarc(goal.x,-goal.z,goal.radius,0,Math.PI*2,true);baseShape.holes.push(hole);
    }
    for(const hazard of nextLayout.hazards||[]){
      const hole=new THREE.Path();hole.absarc(hazard.x,-hazard.z,hazard.radius,0,Math.PI*2,true);baseShape.holes.push(hole);
    }
    add(extrude(baseShape,.20,.055),surface,0,-.255);
    for(const hazard of nextLayout.hazards||[]){
      const wellMaterial=new THREE.MeshStandardMaterial({color:0x2c251d,roughness:.61,side:THREE.DoubleSide});
      add(new THREE.CylinderGeometry(hazard.radius,hazard.radius-.025,.36,48,1,true),wellMaterial,hazard.x,-.17,hazard.z,false);
      const bottom=add(new THREE.CircleGeometry(hazard.radius-.025,48),new THREE.MeshStandardMaterial({color:0x171b20,roughness:.94}),hazard.x,-.35,hazard.z,false);bottom.rotation.x=-Math.PI/2;
      const rimMaterial=new THREE.MeshPhysicalMaterial({color:0xb77e37,metalness:.50,roughness:.32,clearcoat:.3});
      const rim=add(new THREE.TorusGeometry(hazard.radius+.011,.014,10,64),rimMaterial,hazard.x,.012,hazard.z,true);rim.rotation.x=-Math.PI/2;
    }
    for(const barrier of nextLayout.barriers){
      const obstacle=new THREE.Group();group.add(obstacle);if(barrier.motion)parts.push({group:obstacle,motion:barrier.motion});
      add(extrude(barrierShape(barrier),barrier.height-.11,.055),pearl,0,.055,0,true,obstacle);
      const curve=new THREE.CatmullRomCurve3(barrier.points.map(p=>new THREE.Vector3(p.x,barrier.height+.002,p.z)));
      add(new THREE.TubeGeometry(curve,Math.min(512,Math.max(48,barrier.points.length*2)),.013,5,false),new THREE.MeshStandardMaterial({color:0xe6e8eb,metalness:.45,roughness:.3}),0,0,0,false,obstacle);
    }
    for(const b of nextLayout.bumpers||[]){
      const obstacle=new THREE.Group();group.add(obstacle);if(b.motion)parts.push({group:obstacle,motion:b.motion});
      if(b.motion){
        // A fine stationary travel mark makes a patrolling puck legible without
        // turning the pearl deck into a diagram. It stays within the swept disk.
        const ax=b.motion.axis==='x'?b.motion.amplitude:0,az=b.motion.axis==='z'?b.motion.amplitude:0;
        const guideMaterial=new THREE.MeshStandardMaterial({color:0x9ba5ad,metalness:.18,roughness:.7});
        const guide=new THREE.LineCurve3(new THREE.Vector3(b.x-ax,.005,b.z-az),new THREE.Vector3(b.x+ax,.005,b.z+az));
        add(new THREE.TubeGeometry(guide,1,.007,5,false),guideMaterial,0,0,0,false);
        for(const sign of[-1,1]){
          const stop=add(new THREE.CircleGeometry(.023,16),guideMaterial,b.x+sign*ax,.008,b.z+sign*az,false);stop.rotation.x=-Math.PI/2;
        }
      }
      // The collision radius is also the greatest rendered radius. Independent
      // cobalt caps and metal skirts distinguish hazards from the pearl walls.
      add(new THREE.CylinderGeometry(b.radius,b.radius,.045,40),dark,b.x,.023,b.z,true,obstacle);
      add(new THREE.CylinderGeometry(b.radius*.91,b.radius,b.height-.085,40),chrome,b.x,(b.height-.085)/2+.045,b.z,true,obstacle);
      add(new THREE.CylinderGeometry(b.radius*.85,b.radius*.91,.04,40),blue,b.x,b.height-.02,b.z,true,obstacle);
      const rim=add(new THREE.TorusGeometry(b.radius*.83,.009,6,40),chrome,b.x,b.height+.002,b.z,false,obstacle);rim.rotation.x=-Math.PI/2;
      if(b.motion){
        add(new THREE.BoxGeometry(b.motion.axis==='x'?b.radius*.65:.014,.003,b.motion.axis==='z'?b.radius*.65:.014),chrome,b.x,b.height+.008,b.z,false,obstacle);
      }
    }
    const goalGroup=new THREE.Group();group.add(goalGroup);
    if(goal.motion){
      const travelX=goal.motion.axis==='x'?Math.abs(goal.motion.amplitude):0;
      const travelZ=goal.motion.axis==='z'?Math.abs(goal.motion.amplitude):0;
      const halfX=goal.radius+travelX*2+.10,halfZ=goal.radius+travelZ*2+.10;
      const slider=roundedRect(goal.x-halfX,goal.x+halfX,goal.z-halfZ,goal.z+halfZ,.10),hole=new THREE.Path();
      hole.absarc(goal.x,-goal.z,goal.radius,0,Math.PI*2,true);slider.holes.push(hole);
      // Recess the slider slightly below the fixed deck. Its generous overlap
      // travels underneath neighboring walls and stays occluded outside the
      // aperture, so no moving plate edge can appear in an adjacent corridor.
      add(extrude(slider,.20,.025),surface,0,-.231,0,true,goalGroup);
      parts.push({group:goalGroup,motion:goal.motion});
    }
    add(new THREE.CylinderGeometry(goal.radius,goal.radius-.04,.34,64,1,true),new THREE.MeshStandardMaterial({color:0x132867,roughness:.46,side:THREE.DoubleSide}),goal.x,-.16,goal.z,false,goalGroup);
    const bottom=add(new THREE.CircleGeometry(goal.radius-.03,64),new THREE.MeshStandardMaterial({color:0x10244f,roughness:.9}),goal.x,-.33,goal.z,false,goalGroup);bottom.rotation.x=-Math.PI/2;
    // The moving pocket has a slimmer lip to clear the final maze chamber at
    // both travel extremes; static pockets keep their original rounded rim.
    const rimOffset=goal.motion?.006:.028,rimWidth=goal.motion?.014:.04;
    const goalRing=add(new THREE.TorusGeometry(goal.radius+rimOffset,rimWidth,18,80),blue.clone(),goal.x,.014,goal.z,true,goalGroup);goalRing.rotation.x=-Math.PI/2;
    const ringInside=add(new THREE.TorusGeometry(goal.radius-.018,.009,6,80),chrome,goal.x,.018,goal.z,false,goalGroup);ringInside.rotation.x=-Math.PI/2;
    const start=add(new THREE.RingGeometry(.30,.314,64),new THREE.MeshBasicMaterial({color:0x8390a3,transparent:true,opacity:.48,side:THREE.DoubleSide}),nextLayout.start.x,.007,nextLayout.start.z,false);start.rotation.x=-Math.PI/2;
    return {group,ring:goalRing,startMark:start,movingParts:parts};
  }
  function disposeCourse(group){
    const geometries=new Set(),materials=new Set();
    group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const material of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){if(!sharedMaterials.has(material))materials.add(material);}});
    for(const geometry of geometries)geometry.dispose();
    for(const material of materials)material.dispose();
  }

  // Uninterrupted rim; rubber feet sit beneath the case.
  for(const [x,z]of[[-2.55,-2.6],[2.55,-2.6],[-2.55,3.55],[2.55,3.55]])mesh(new THREE.CylinderGeometry(.20,.22,.12,32),new THREE.MeshStandardMaterial({color:0x343d4b,roughness:.95}),x,-.56,z);
  const marbleMaterial=chrome.clone();marbleMaterial.transparent=true;
  const marble=mesh(new THREE.SphereGeometry(layout.radius,64,48),marbleMaterial);marble.receiveShadow=false;
  const ballShadow=mesh(new THREE.PlaneGeometry(.8,.8),new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,opacity:.9,depthWrite:false}),0,.008,0,false);ballShadow.rotation.x=-Math.PI/2;
  let sink=0,width=1,height=1;
  const screenPoint=p=>{p.project(camera);return {x:(p.x*.5+.5)*width,y:(-.5*p.y+.5)*height};};
  const projectPoint=(x,y,z)=>{
    const p=tray.localToWorld(new THREE.Vector3(x,y,z)).project(camera);
    return {x:(p.x*.5+.5)*width,y:(-.5*p.y+.5)*height};
  };
  function projectProfile(){
    if(!profileElement)return;
    tray.updateWorldMatrix(true,false);camera.updateMatrixWorld();
    const p=projectPoint(-2.63,.432,3.19),px=projectPoint(2.63,.432,3.19),py=projectPoint(-2.63,.432,4.19);
    profileElement.style.transform='matrix('+[(px.x-p.x)/540,(px.y-p.y)/540,(py.x-p.x)/110,(py.y-p.y)/110,p.x,p.y].join(',')+')';
    profileElement.classList.add('is-mounted');
    profileElement.hidden=false;
  }
  function projectControls(){
    // Keep input choices beneath the tray and leave room for calibration controls.
    let bottom=0;
    for(const x of [-3.49,3.49])for(const y of [-.6,.5])for(const z of [-3.49,4.55]){
      bottom=Math.max(bottom,screenPoint(new THREE.Vector3(x,y+.08,z)).y);
    }
    const controlsHeight=document.querySelector('#game-controls .controls')?.offsetHeight||48;
    const mobileCamera=window.innerWidth<=700&&document.body.classList.contains('camera-active');
    const gap=mobileCamera?12:38;
    const top=Math.min(window.innerHeight-controlsHeight-24,canvas.getBoundingClientRect().top+bottom+gap);
    document.documentElement.style.setProperty('--camera-top',top+'px');
  }
  function resize(){
    const r=canvas.getBoundingClientRect();width=r.width;height=r.height;if(!width||!height)return;
    renderer.setSize(width,height,false);
    const aspect=width/height,span=aspect<1?10.1/aspect:11.5;
    camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();projectProfile();alignStatusWithRole();
    projectControls();
  }
  function update(state,tiltX,tiltZ,dt){
    const goal=currentLayout.goal,radius=currentLayout.radius;
    const motionTime=state.motionTime??state.elapsed,goalOffset=sampleMotion(goal.motion,motionTime);
    for(const part of movingParts){const offset=part.motion===goal.motion?goalOffset:sampleMotion(part.motion,motionTime);part.group.position.set(offset.x,0,offset.z);}
    tray.rotation.z=-tiltX*.13;tray.rotation.x=tiltZ*.13;
    sink=THREE.MathUtils.damp(sink,state.won?1:0,8,dt);
    if(state.falling){
      const progress=THREE.MathUtils.clamp(state.fallProgress||0,0,1),center=THREE.MathUtils.smoothstep(progress,0,.6);
      const fallX=Number.isFinite(state.fallX)?state.fallX:state.x,fallZ=Number.isFinite(state.fallZ)?state.fallZ:state.z;
      marble.position.set(THREE.MathUtils.lerp(state.x,fallX,center),radius-(radius+.40)*progress*progress,THREE.MathUtils.lerp(state.z,fallZ,center));
      marble.scale.setScalar(1-.22*THREE.MathUtils.smoothstep(progress,.25,1));
      marbleMaterial.opacity=1-THREE.MathUtils.smoothstep(progress,.55,.95);marble.visible=progress<.96;marble.castShadow=progress<.25;
    }else{
      // Respawn coordinates are assigned directly; the only interpolation is
      // local to the current hole, so no across-the-board return flight occurs.
      marble.position.set(THREE.MathUtils.lerp(state.x,goal.x+goalOffset.x,sink),radius-Math.max(0,(sink-.65)/.35)*.29,THREE.MathUtils.lerp(state.z,goal.z+goalOffset.z,sink));
      marble.scale.setScalar(1);marbleMaterial.opacity=1;marble.visible=true;marble.castShadow=true;
    }
    marble.rotation.z-=state.vx*dt/radius;marble.rotation.x+=state.vz*dt/radius;
    ballShadow.position.x=state.x;ballShadow.position.z=state.z;ballShadow.visible=!state.won&&!state.falling;
    ring.material.emissive.setHex(state.won?0x142fe0:0x000000);ring.material.emissiveIntensity=state.won?.35:0;
    startMark.material.opacity=state.started?.18:.48;
    lightTime+=Math.max(0,Math.min(dt,.2));
    const breathe=reducedMotion.matches?.5:(Math.sin(lightTime*.75)+1)/2;
    statusMaterial.emissiveIntensity=2.05+breathe*.45;statusLight.intensity=.25+breathe*.07;statusGlow.material.opacity=.63+breathe*.08;
    projectProfile();projectControls();
    renderer.render(scene,camera);
  }
  function setLayout(nextLayout){
    const replacement=buildCourse(nextLayout);
    if(course){tray.remove(course);disposeCourse(course);}
    course=replacement.group;ring=replacement.ring;startMark=replacement.startMark;movingParts=replacement.movingParts;tray.add(course);
    for(const part of movingParts){const offset=sampleMotion(part.motion,0);part.group.position.set(offset.x,0,offset.z);}
    if(nextLayout.radius!==currentLayout.radius){marble.geometry.dispose();marble.geometry=new THREE.SphereGeometry(nextLayout.radius,64,48);}
    currentLayout=nextLayout;sink=0;
    tray.rotation.set(0,0,0);marble.rotation.set(0,0,0);
    marble.position.set(nextLayout.start.x,nextLayout.radius,nextLayout.start.z);
    marble.scale.setScalar(1);marbleMaterial.opacity=1;marble.visible=true;marble.castShadow=true;
    ballShadow.position.set(nextLayout.start.x,.008,nextLayout.start.z);ballShadow.visible=true;
    blue.emissive.setHex(0x000000);blue.emissiveIntensity=0;
  }
  function dispose(){environment.dispose();const textures=new Set(),materials=new Set(),geometries=new Set();scene.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);if(m.map)textures.add(m.map);}});for(const t of textures)t.dispose();for(const m of materials)m.dispose();for(const g of geometries)g.dispose();renderer.dispose();}
  setLayout(layout);resize();return {update,resize,setLayout,dispose,get needsIdleAnimation(){return !reducedMotion.matches;},get hasMovingParts(){return movingParts.length>0;}};
}
