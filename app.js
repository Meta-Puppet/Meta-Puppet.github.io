(function(){
  var META = {"vertCount":148424,"indexCount":889356,"bbox":{"minX":-176.8699493408203,"minY":-10.98410701751709,"minZ":-309.234375,"maxX":279.13226318359375,"maxY":18.97367286682129,"maxZ":-3.459334135055542}};

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fetchBuf(url){
    return fetch(url).then(function(r){
      if (!r.ok) throw new Error(url + ': ' + r.status);
      return r.arrayBuffer();
    });
  }

  Promise.all([
    fetchBuf('assets/mesh_pos.bin'),
    fetchBuf('assets/mesh_norm.bin'),
    fetchBuf('assets/mesh_idx.bin')
  ]).then(function(bufs){
    init(bufs[0], bufs[1], bufs[2]);
  }).catch(function(err){
    // the page works as a plain text page without the 3D stage
    console.warn('MetaPuppet stage disabled:', err);
  });

  function init(posBuf, normBuf, idxBuf){
    var posU16 = new Uint16Array(posBuf);
    var normI8 = new Int8Array(normBuf);
    var idx32 = new Uint32Array(idxBuf);

    var bbox = META.bbox;
    var vertCount = META.vertCount;
    var scaleX = (bbox.maxX-bbox.minX) || 1;
    var scaleY = (bbox.maxY-bbox.minY) || 1;
    var scaleZ = (bbox.maxZ-bbox.minZ) || 1;

    var positions = new Float32Array(vertCount*3);
    var normals = new Float32Array(vertCount*3);
    var cx = 0, cy = 0, cz = 0;
    for (var i=0;i<vertCount;i++){
      var x = bbox.minX + (posU16[i*3+0]/65535)*scaleX;
      var y = bbox.minY + (posU16[i*3+1]/65535)*scaleY;
      var z = bbox.minZ + (posU16[i*3+2]/65535)*scaleZ;
      positions[i*3+0]=x; positions[i*3+1]=y; positions[i*3+2]=z;
      normals[i*3+0]=normI8[i*3+0]/127; normals[i*3+1]=normI8[i*3+1]/127; normals[i*3+2]=normI8[i*3+2]/127;
      cx+=x; cy+=y; cz+=z;
    }
    cx/=vertCount; cy/=vertCount; cz/=vertCount;

    var maxDim = Math.max(scaleX, scaleY, scaleZ);
    var fitScale = 3.4 / maxDim;
    for (var i2=0;i2<vertCount;i2++){
      positions[i2*3+0] = (positions[i2*3+0]-cx) * fitScale;
      positions[i2*3+1] = (positions[i2*3+1]-cy) * fitScale;
      positions[i2*3+2] = (positions[i2*3+2]-cz) * fitScale;
    }

    var canvas = document.getElementById('stage');
    var renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true, alpha:false, powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020202);

    var camera = new THREE.PerspectiveCamera(38, window.innerWidth/window.innerHeight, 0.1, 100);
    camera.position.set(0, 0.1, 6.2);

    function resize(){
      var w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w/h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);

    // --- procedural studio environment for chrome reflections ---
    function buildEnvScene(){
      var s = new THREE.Scene();
      var geo = new THREE.BoxGeometry(1,1,1, 1,1,1);
      // invert normals so we render inside faces
      var box = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color:0x050506, side:THREE.BackSide}));
      box.scale.set(30,30,30);
      s.add(box);

      function panel(x,y,z, rx,ry,rz, w,h, color, intensity){
        var g = new THREE.PlaneGeometry(w,h);
        var m = new THREE.MeshBasicMaterial({color:color});
        var mesh = new THREE.Mesh(g,m);
        mesh.position.set(x,y,z);
        mesh.rotation.set(rx,ry,rz);
        mesh.material.color.multiplyScalar(intensity);
        s.add(mesh);
      }
      panel(0, 8, 0, Math.PI/2, 0, 0, 20, 12, 0xffffff, 3.2);
      panel(-10, 2, 4, 0, Math.PI/2.4, 0, 10, 14, 0xf6c9dd, 2.4);
      panel(10, 1, -4, 0, -Math.PI/2.6, 0, 10, 14, 0xbfe6ea, 1.6);
      panel(0, -6, 6, -Math.PI/3, 0, 0, 14, 10, 0xffffff, 0.9);
      return s;
    }

    var pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    var envRT = pmrem.fromScene(buildEnvScene(), 0.04);
    scene.environment = envRT.texture;

    // --- geometry ---
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(idx32, 1));

    var material = new THREE.MeshPhysicalMaterial({
      color: 0x0b0b0d,
      metalness: 1.0,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
      iridescence: 0.9,
      iridescenceIOR: 1.35,
      iridescenceThicknessRange: [120, 420],
      envMapIntensity: 1.6
    });

    // per-vertex "tip factor": ~0 near the body, rising toward the extremities
    // (drip ends / letter tips), so the jiggle only happens at the edges.
    var radii = new Float32Array(vertCount);
    var maxR = 0;
    for (var ri=0; ri<vertCount; ri++){
      var rx=positions[ri*3+0], ry=positions[ri*3+1], rz=positions[ri*3+2];
      var r = Math.sqrt(rx*rx+ry*ry+rz*rz);
      radii[ri] = r;
      if (r > maxR) maxR = r;
    }
    var aTip = new Float32Array(vertCount);
    for (var ti=0; ti<vertCount; ti++){
      var n = radii[ti]/maxR;
      aTip[ti] = 0.35 + 0.65 * Math.pow(Math.max(0, (n-0.1)/0.9), 1.6);
    }
    geometry.setAttribute('aTip', new THREE.BufferAttribute(aTip, 1));

    var uTime = { value: 0 };
    material.onBeforeCompile = function(shader){
      shader.uniforms.uTime = uTime;
      shader.vertexShader = 'uniform float uTime;\nattribute float aTip;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'float phase = fract(sin(dot(position.xz, vec2(1.9898,1.78233))) * 43758.5453) * 6.2831853;\n' +
        'float jitter = sin(uTime*2.1 + phase) * 0.6 + sin(uTime*3.4 + phase*1.3) * 0.4;\n' +
        'transformed += normal * jitter * 0.026 * aTip;'
      );
      material.userData.shader = shader;
    };

    var mesh = new THREE.Mesh(geometry, material);
    // static base orientation: the FBX lies flat (thin on Y), tip it up to face camera.
    mesh.rotation.x = Math.PI/2 - 0.3;
    mesh.rotation.y = 0.4;
    mesh.rotation.z = THREE.MathUtils.degToRad(-15);
    mesh.position.x = 0.5;
    scene.add(mesh);

    var rimLight = new THREE.PointLight(0xffffff, 40, 30);
    rimLight.position.set(-4, 3, 5);
    scene.add(rimLight);
    var rimLight2 = new THREE.PointLight(0xffb3d1, 18, 30);
    rimLight2.position.set(5, -2, 4);
    scene.add(rimLight2);
    scene.add(new THREE.AmbientLight(0x202024, 0.6));

    resize();

    if (reducedMotion){
      // single static frame: no vertex jitter, no pointer tilt, no rAF loop
      renderer.render(scene, camera);
      requestAnimationFrame(function(){ canvas.classList.add('ready'); });
      window.addEventListener('resize', function(){ renderer.render(scene, camera); });
      return;
    }

    var baseRotX = mesh.rotation.x, baseRotY = mesh.rotation.y;
    var targetTiltX = 0, targetTiltY = 0;
    var curTiltX = 0, curTiltY = 0;
    window.addEventListener('pointermove', function(e){
      var nx = (e.clientX / window.innerWidth) * 2 - 1;
      var ny = (e.clientY / window.innerHeight) * 2 - 1;
      targetTiltY = nx * 0.06;
      targetTiltX = ny * 0.04;
    });

    var clock = new THREE.Clock();
    var revealed = false;
    function animate(){
      requestAnimationFrame(animate);
      var t = clock.getElapsedTime();
      uTime.value = t;

      curTiltX += (targetTiltX - curTiltX) * 0.04;
      curTiltY += (targetTiltY - curTiltY) * 0.04;

      mesh.rotation.x = baseRotX + curTiltX;
      mesh.rotation.y = baseRotY + curTiltY;

      renderer.render(scene, camera);

      if (!revealed){
        revealed = true;
        requestAnimationFrame(function(){ canvas.classList.add('ready'); });
      }
    }
    animate();
  }
})();
