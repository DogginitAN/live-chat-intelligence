/**
 * FlowState Universe - Immersive 3D Chat Visualizer
 * 
 * Inspired by Belle, Ready Player One, Wreck-it Ralph 2
 * Messages fly through space, tickers become celestial bodies
 */

// ============== CONFIG ==============

const urlParams = new URLSearchParams(window.location.search);
const BACKEND_URL = urlParams.get('backend') || 'wss://web-production-6fa01.up.railway.app';
const initialVideoId = urlParams.get('v') || '';

// ============== STATE ==============

const state = {
    connected: false,
    videoId: null,
    ws: null,
    
    // Data
    tickers: {},         // ticker -> { count, sentiment, orb }
    flyingMessages: [],  // Active message sprites
    vibeParticles: [],   // Active vibe explosions
    
    // Velocity tracking
    recentMessages: [],
    velocity: 0
};

// ============== THREE.JS GLOBALS ==============

let scene, camera, renderer, clock;
let starfield, nebula;
let tickerOrbs = new THREE.Group();
let messageTrails = new THREE.Group();

// Camera control state
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let cameraTarget = new THREE.Vector3(0, 0, 0);
let cameraDistance = 150;
let cameraTheta = 0;  // Horizontal angle
let cameraPhi = Math.PI / 3;  // Vertical angle (start looking down slightly)

// Colors
const COLORS = {
    bullish: 0x22c55e,
    bearish: 0xef4444,
    neutral: 0x64748b,
    funny: 0x9333ea,
    uplifting: 0xec4899,
    message: 0x38bdf8,
    question: 0xfbbf24
};

// ============== INITIALIZATION ==============

function init() {
    console.log('[Universe] Initializing...');
    
    initThree();
    console.log('[Universe] Three.js initialized');
    
    initControls();
    console.log('[Universe] Controls initialized');
    
    animate();
    console.log('[Universe] Animation started');
    
    // UI event listeners
    const connectBtn = document.getElementById('connect-btn');
    const videoInput = document.getElementById('video-input');
    
    console.log('[Universe] Connect button found:', !!connectBtn);
    console.log('[Universe] Video input found:', !!videoInput);
    
    if (connectBtn) {
        connectBtn.addEventListener('click', handleConnect);
        console.log('[Universe] Click listener added to connect button');
    }
    
    if (videoInput) {
        videoInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleConnect();
        });
    }
    
    // Velocity calculator
    setInterval(calculateVelocity, 500);
    
    // Auto-connect if video ID provided
    if (initialVideoId) {
        console.log('[Universe] Auto-connecting to:', initialVideoId);
        document.getElementById('video-input').value = initialVideoId;
        setTimeout(handleConnect, 500);
    }
}

function initThree() {
    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.002);
    
    // Camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 2000);
    updateCameraPosition();
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    document.getElementById('canvas-container').appendChild(renderer.domElement);
    
    // Clock
    clock = new THREE.Clock();
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0x1a1a2e, 1);
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0x4060ff, 1, 500);
    pointLight.position.set(0, 50, 0);
    scene.add(pointLight);
    
    // Add groups
    scene.add(tickerOrbs);
    scene.add(messageTrails);
    
    // Create environment
    createStarfield();
    createNebula();
    createCentralCore();
    
    // Handle resize
    window.addEventListener('resize', onResize);
}

function initControls() {
    const canvas = renderer.domElement;
    
    // Mouse drag for orbit
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;
        
        cameraTheta -= deltaX * 0.005;
        cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi + deltaY * 0.005));
        
        previousMousePosition = { x: e.clientX, y: e.clientY };
        updateCameraPosition();
    });
    
    canvas.addEventListener('mouseup', () => isDragging = false);
    canvas.addEventListener('mouseleave', () => isDragging = false);
    
    // Scroll for zoom
    canvas.addEventListener('wheel', (e) => {
        cameraDistance = Math.max(50, Math.min(400, cameraDistance + e.deltaY * 0.3));
        updateCameraPosition();
    });
    
    // Double click to reset
    canvas.addEventListener('dblclick', () => {
        cameraDistance = 150;
        cameraTheta = 0;
        cameraPhi = Math.PI / 3;
        updateCameraPosition();
    });
}

function updateCameraPosition() {
    camera.position.x = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    camera.position.y = cameraDistance * Math.cos(cameraPhi);
    camera.position.z = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);
    camera.lookAt(cameraTarget);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============== ENVIRONMENT ==============

function createStarfield() {
    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 8000;  // More stars
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    
    for (let i = 0; i < starCount; i++) {
        const i3 = i * 3;
        
        // Distribute in a sphere
        const radius = 400 + Math.random() * 600;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        
        positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i3 + 2] = radius * Math.cos(phi);
        
        // Vary star colors - add some blue/yellow tints
        const colorRand = Math.random();
        let r, g, b;
        if (colorRand < 0.1) {
            // Blue-white stars (bright)
            r = 0.8; g = 0.9; b = 1.0;
        } else if (colorRand < 0.15) {
            // Yellow/orange stars
            r = 1.0; g = 0.9; b = 0.7;
        } else {
            // Regular white stars
            const brightness = 0.6 + Math.random() * 0.4;
            r = brightness; g = brightness; b = brightness + Math.random() * 0.1;
        }
        colors[i3] = r;
        colors[i3 + 1] = g;
        colors[i3 + 2] = b;
        
        // Vary sizes - some prominent bright stars
        sizes[i] = Math.random() < 0.02 ? 4 + Math.random() * 3 : 1.5 + Math.random() * 1.5;
    }
    
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const starsMaterial = new THREE.PointsMaterial({
        size: 2.5,  // Larger base size
        vertexColors: true,
        transparent: true,
        opacity: 1.0,  // Full opacity
        sizeAttenuation: true
    });
    
    starfield = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starfield);
    
    // Add a second layer of bright prominent stars
    const brightStarsGeometry = new THREE.BufferGeometry();
    const brightCount = 100;
    const brightPositions = new Float32Array(brightCount * 3);
    const brightColors = new Float32Array(brightCount * 3);
    
    for (let i = 0; i < brightCount; i++) {
        const i3 = i * 3;
        const radius = 450 + Math.random() * 500;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        
        brightPositions[i3] = radius * Math.sin(phi) * Math.cos(theta);
        brightPositions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        brightPositions[i3 + 2] = radius * Math.cos(phi);
        
        // Bright white/blue
        brightColors[i3] = 0.9 + Math.random() * 0.1;
        brightColors[i3 + 1] = 0.95 + Math.random() * 0.05;
        brightColors[i3 + 2] = 1.0;
    }
    
    brightStarsGeometry.setAttribute('position', new THREE.BufferAttribute(brightPositions, 3));
    brightStarsGeometry.setAttribute('color', new THREE.BufferAttribute(brightColors, 3));
    
    const brightStarsMaterial = new THREE.PointsMaterial({
        size: 5,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending
    });
    
    const brightStars = new THREE.Points(brightStarsGeometry, brightStarsMaterial);
    scene.add(brightStars);
}

function createNebula() {
    // Shader-based procedural nebula on a large background sphere
    const nebulaVertexShader = `
        varying vec2 vUv;
        varying vec3 vPosition;
        void main() {
            vUv = uv;
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    
    const nebulaFragmentShader = `
        uniform float time;
        uniform vec2 resolution;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        // Simplex noise functions
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        
        float snoise(vec3 v) {
            const vec2 C = vec2(1.0/6.0, 1.0/3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            
            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);
            
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);
            
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            
            i = mod289(i);
            vec4 p = permute(permute(permute(
                     i.z + vec4(0.0, i1.z, i2.z, 1.0))
                   + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                   + i.x + vec4(0.0, i1.x, i2.x, 1.0));
            
            float n_ = 0.142857142857;
            vec3 ns = n_ * D.wyz - D.xzx;
            
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_);
            
            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            
            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);
            
            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            
            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
            
            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);
            
            vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;
            
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }
        
        // Fractal Brownian Motion
        float fbm(vec3 p) {
            float value = 0.0;
            float amplitude = 0.5;
            float frequency = 1.0;
            for (int i = 0; i < 5; i++) {
                value += amplitude * snoise(p * frequency);
                amplitude *= 0.5;
                frequency *= 2.0;
            }
            return value;
        }
        
        void main() {
            // Use spherical position for seamless wrapping
            vec3 pos = normalize(vPosition) * 2.0;
            
            // Animate slowly
            float t = time * 0.02;
            
            // Multiple noise layers for depth
            float n1 = fbm(pos + vec3(t * 0.5, t * 0.3, t * 0.2));
            float n2 = fbm(pos * 2.0 + vec3(-t * 0.3, t * 0.4, -t * 0.1));
            float n3 = fbm(pos * 0.5 + vec3(t * 0.1, -t * 0.2, t * 0.3));
            
            // Combine noise layers
            float nebulaDensity = (n1 + n2 * 0.5 + n3 * 0.25) * 0.5 + 0.5;
            nebulaDensity = pow(nebulaDensity, 1.5);  // Increase contrast
            
            // Color palette - deep space purples, blues, teals
            vec3 color1 = vec3(0.1, 0.05, 0.2);   // Deep purple
            vec3 color2 = vec3(0.05, 0.1, 0.25);  // Deep blue
            vec3 color3 = vec3(0.0, 0.15, 0.2);   // Teal
            vec3 color4 = vec3(0.2, 0.05, 0.15);  // Magenta hint
            
            // Mix colors based on noise
            vec3 col = mix(color1, color2, n1 * 0.5 + 0.5);
            col = mix(col, color3, n2 * 0.3 + 0.3);
            col = mix(col, color4, n3 * 0.2 + 0.2);
            
            // Add some brighter wisps
            float wisps = pow(max(0.0, n1 * n2), 2.0) * 2.0;
            col += vec3(0.1, 0.15, 0.3) * wisps;
            
            // Fade based on density
            float alpha = nebulaDensity * 0.4;  // Keep it subtle
            
            gl_FragColor = vec4(col, alpha);
        }
    `;
    
    const nebulaGeometry = new THREE.SphereGeometry(800, 64, 64);
    const nebulaMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: nebulaVertexShader,
        fragmentShader: nebulaFragmentShader,
        transparent: true,
        side: THREE.BackSide,  // Render on inside of sphere
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    
    nebula = new THREE.Mesh(nebulaGeometry, nebulaMaterial);
    scene.add(nebula);
}

let centralCore, coreGlows = [];

function createCentralCore() {
    // Glowing central core where tickers orbit
    const coreGeometry = new THREE.SphereGeometry(5, 32, 32);
    const coreMaterial = new THREE.MeshBasicMaterial({
        color: 0x6080ff,
        transparent: true,
        opacity: 0.9
    });
    centralCore = new THREE.Mesh(coreGeometry, coreMaterial);
    scene.add(centralCore);
    
    // Multiple glow layers for bloom effect
    const glowSizes = [8, 12, 18, 28, 40];
    const glowOpacities = [0.5, 0.35, 0.2, 0.12, 0.06];
    
    glowSizes.forEach((size, i) => {
        const glowGeometry = new THREE.SphereGeometry(size, 32, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0x4060ff,
            transparent: true,
            opacity: glowOpacities[i],
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        coreGlows.push(glow);
        scene.add(glow);
    });
    
    // Add large soft glow sprite for extra bloom
    const coreGlowMaterial = new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0x4080ff,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const coreGlowSprite = new THREE.Sprite(coreGlowMaterial);
    coreGlowSprite.scale.set(60, 60, 1);
    coreGlowSprite.userData.isCoreGlow = true;
    coreGlows.push(coreGlowSprite);
    scene.add(coreGlowSprite);
    
    // Add a bright point light at core
    const coreLight = new THREE.PointLight(0x4060ff, 2.5, 150);
    coreLight.position.set(0, 0, 0);
    scene.add(coreLight);
    
    // Add rotating energy rings
    for (let i = 0; i < 3; i++) {
        const ringGeometry = new THREE.RingGeometry(10 + i * 4, 11 + i * 4, 64);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0x4080ff,
            transparent: true,
            opacity: 0.3 - i * 0.08,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2 + (i * 0.3);
        ring.rotation.y = i * 0.5;
        ring.userData.rotationSpeed = 0.2 + i * 0.1;
        ring.userData.isEnergyRing = true;
        coreGlows.push(ring);
        scene.add(ring);
    }
}

// ============== TICKER ORBS ==============

// Golden angle for even distribution
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
let orbSpawnIndex = 0;

// Create reusable glow texture for bloom effect
let glowTexture = null;
function getGlowTexture() {
    if (glowTexture) return glowTexture;
    
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Radial gradient - soft glow falloff
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.1, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    
    glowTexture = new THREE.CanvasTexture(canvas);
    return glowTexture;
}

function findNonCollidingPosition(baseAngle, baseRadius, baseHeight) {
    const minDistance = 15;  // Minimum distance between orb centers
    let attempts = 0;
    let angle = baseAngle;
    let radius = baseRadius;
    let height = baseHeight;
    
    while (attempts < 20) {
        const testPos = new THREE.Vector3(
            Math.cos(angle) * radius,
            height,
            Math.sin(angle) * radius
        );
        
        let collision = false;
        for (const existingOrb of tickerOrbs.children) {
            const dist = testPos.distanceTo(existingOrb.position);
            if (dist < minDistance) {
                collision = true;
                break;
            }
        }
        
        if (!collision) {
            return { angle, radius, height };
        }
        
        // Try different position
        attempts++;
        angle += GOLDEN_ANGLE * 0.3;
        radius = 30 + ((radius - 30 + 10) % 50);  // Cycle through radii
        height = (Math.random() - 0.5) * 40;
    }
    
    // Fallback: just offset from base
    return { 
        angle: baseAngle + Math.random() * 0.5, 
        radius: baseRadius + Math.random() * 20, 
        height: baseHeight + (Math.random() - 0.5) * 20 
    };
}

function createTickerOrb(ticker, sentiment) {
    const color = COLORS[sentiment] || COLORS.neutral;
    
    // Main sphere
    const geometry = new THREE.SphereGeometry(3, 32, 32);
    const material = new THREE.MeshPhongMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.3,
        shininess: 50,
        transparent: true,
        opacity: 0.9
    });
    
    const orb = new THREE.Mesh(geometry, material);
    
    // Use golden angle for even distribution
    orbSpawnIndex++;
    const baseAngle = orbSpawnIndex * GOLDEN_ANGLE;
    const baseRadius = 35 + (orbSpawnIndex % 5) * 8;  // Stagger radii
    const baseHeight = ((orbSpawnIndex % 7) - 3) * 6;  // Stagger heights
    
    // Find non-colliding position
    const { angle, radius, height } = findNonCollidingPosition(baseAngle, baseRadius, baseHeight);
    
    orb.position.set(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius
    );
    
    // Add glow ring
    const ringGeometry = new THREE.RingGeometry(4, 5, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    orb.add(ring);
    
    // Add bloom glow sprite (soft halo behind orb)
    const glowMaterial = new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const glowSprite = new THREE.Sprite(glowMaterial);
    glowSprite.scale.set(18, 18, 1);  // Larger than orb for bloom effect
    glowSprite.name = 'glowSprite';
    orb.add(glowSprite);
    
    // Add ticker text label
    const label = createTextLabel(ticker);
    label.position.y = 5;
    orb.add(label);
    
    // Add count label (monochrome, below ticker)
    const countLabel = createCountLabel(1);
    countLabel.position.y = -4;
    countLabel.name = 'countLabel';
    orb.add(countLabel);
    
    // START TINY - birth animation
    orb.scale.setScalar(0.01);
    
    // Store metadata
    orb.userData = {
        ticker: ticker,
        orbitAngle: angle,
        orbitRadius: radius,
        orbitSpeed: 0.001 + Math.random() * 0.002,
        baseY: height,
        bobOffset: Math.random() * Math.PI * 2,
        targetScale: 1,
        // Birth animation state
        isBirthing: true,
        birthProgress: 0,
        birthDuration: 60  // ~1 second at 60fps
    };
    
    tickerOrbs.add(orb);
    return orb;
}

function createCountLabel(count) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 64;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Monochrome count - subtle white/gray
    ctx.font = 'bold 32px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(count.toString(), 64, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(5, 2.5, 1);
    return sprite;
}

function updateCountLabel(orb, count) {
    const countLabel = orb.children.find(c => c.name === 'countLabel');
    if (countLabel) {
        // Update the texture with new count
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 64;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.font = 'bold 32px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText(count.toString(), 64, 32);
        
        // Dispose old texture and create new one
        countLabel.material.map.dispose();
        countLabel.material.map = new THREE.CanvasTexture(canvas);
        countLabel.material.needsUpdate = true;
    }
}

function createTextLabel(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.font = 'bold 36px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.fillText(text, 128, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(10, 2.5, 1);
    return sprite;
}

// Sizing constants (matching 2D bubble physics)
const ORB_MIN_SCALE = 0.6;   // Minimum orb size
const ORB_MAX_SCALE = 2.5;   // Maximum orb size (for top ticker)

function updateTickerOrb(ticker, data) {
    let orbData = state.tickers[ticker];
    
    if (!orbData) {
        // Create new orb
        const sentiment = getSentiment(data.sentiment);
        const orb = createTickerOrb(ticker, sentiment);
        orbData = { orb, count: 0, sentiment: data.sentiment };
        state.tickers[ticker] = orbData;
    }
    
    // Update count and scale
    orbData.count = data.count;
    orbData.sentiment = data.sentiment;
    
    // Update count label on the orb
    updateCountLabel(orbData.orb, data.count);
    
    // Recalculate ALL orb scales relative to max (like 2D bubbles)
    recalculateOrbScales();
    
    // Update color based on sentiment
    const sentiment = getSentiment(data.sentiment);
    const color = COLORS[sentiment];
    orbData.orb.material.color.setHex(color);
    orbData.orb.material.emissive.setHex(color);
    
    // Also update ring color
    const ring = orbData.orb.children.find(c => c.geometry?.type === 'RingGeometry');
    if (ring) {
        ring.material.color.setHex(color);
    }
    
    // Update glow sprite color
    const glowSprite = orbData.orb.children.find(c => c.name === 'glowSprite');
    if (glowSprite) {
        glowSprite.material.color.setHex(color);
    }
}

function recalculateOrbScales() {
    // Find max count across all tickers
    let maxCount = 1;
    Object.values(state.tickers).forEach(t => {
        if (t.count > maxCount) maxCount = t.count;
    });
    
    // Update each orb's target scale relative to max
    Object.values(state.tickers).forEach(t => {
        const ratio = t.count / maxCount;  // 0 to 1
        // Use sqrt for more gradual scaling (like bubble physics)
        const scale = ORB_MIN_SCALE + Math.sqrt(ratio) * (ORB_MAX_SCALE - ORB_MIN_SCALE);
        t.orb.userData.targetScale = scale;
    });
}

function getSentiment(sentimentData) {
    const { bullish = 0, bearish = 0 } = sentimentData;
    const total = bullish + bearish;
    if (total === 0) return 'neutral';
    return bullish > bearish ? 'bullish' : 'bearish';
}

// ============== FLYING MESSAGES ==============

function createFlyingMessage(text, sentiment, isQuestion, hasTicker) {
    const color = isQuestion ? COLORS.question : 
                  hasTicker ? COLORS[sentiment] || COLORS.message :
                  COLORS.message;
    
    // Create a group to hold the comet (orb + text trail)
    const comet = new THREE.Group();
    
    // Leading orb - the "soul" of the message
    const orbGeometry = new THREE.SphereGeometry(0.8, 16, 16);
    const orbMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.9
    });
    const orb = new THREE.Mesh(orbGeometry, orbMaterial);
    comet.add(orb);
    
    // Orb glow sprite
    const glowMaterial = new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: color,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const glowSprite = new THREE.Sprite(glowMaterial);
    glowSprite.scale.set(5, 5, 1);
    comet.add(glowSprite);
    
    // Text trail - no background, just glowing text
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1024;
    canvas.height = 80;
    
    // Truncate text
    const maxLen = 50;
    const displayText = text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
    
    // Clear canvas (transparent)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Glowing text effect - multiple passes for bloom
    ctx.font = 'bold 36px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    // Outer glow (larger, more transparent)
    ctx.shadowColor = `#${color.toString(16).padStart(6, '0')}`;
    ctx.shadowBlur = 25;
    ctx.fillStyle = `rgba(255, 255, 255, 0.3)`;
    ctx.fillText(displayText, 20, 40);
    
    // Middle glow
    ctx.shadowBlur = 15;
    ctx.fillStyle = `rgba(255, 255, 255, 0.5)`;
    ctx.fillText(displayText, 20, 40);
    
    // Core text (bright)
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillText(displayText, 20, 40);
    
    const textTexture = new THREE.CanvasTexture(canvas);
    const textMaterial = new THREE.SpriteMaterial({
        map: textTexture,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    const textSprite = new THREE.Sprite(textMaterial);
    textSprite.scale.set(50, 4, 1);
    textSprite.position.x = -28;  // Trail behind the orb
    textSprite.name = 'textTrail';
    comet.add(textSprite);
    
    // Small particle trail behind the orb
    const trailCount = 8;
    for (let i = 0; i < trailCount; i++) {
        const trailMaterial = new THREE.SpriteMaterial({
            map: getGlowTexture(),
            color: color,
            transparent: true,
            opacity: 0.4 * (1 - i / trailCount),
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const trail = new THREE.Sprite(trailMaterial);
        const size = 2.5 * (1 - i / trailCount);
        trail.scale.set(size, size, 1);
        trail.position.x = -(i + 1) * 2;  // Spread behind
        trail.position.y = (Math.random() - 0.5) * 0.5;
        trail.name = 'trail';
        comet.add(trail);
    }
    
    // Start from random position far away
    const startAngle = Math.random() * Math.PI * 2;
    const startRadius = 200 + Math.random() * 100;
    const startY = (Math.random() - 0.5) * 100;
    
    comet.position.set(
        Math.cos(startAngle) * startRadius,
        startY,
        Math.sin(startAngle) * startRadius
    );
    
    // Calculate direction toward center (with some variance)
    const targetX = (Math.random() - 0.5) * 30;
    const targetY = (Math.random() - 0.5) * 30;
    const targetZ = (Math.random() - 0.5) * 30;
    
    const direction = new THREE.Vector3(
        targetX - comet.position.x,
        targetY - comet.position.y,
        targetZ - comet.position.z
    ).normalize();
    
    // Orient comet to face direction of travel
    comet.lookAt(
        comet.position.x + direction.x,
        comet.position.y + direction.y,
        comet.position.z + direction.z
    );
    
    comet.userData = {
        direction: direction,
        speed: 0.4 + Math.random() * 0.3,
        life: 0,
        maxLife: 450 + Math.random() * 150,  // ~7-10 seconds
        textSprite: textSprite,
        orb: orb,
        glowSprite: glowSprite
    };
    
    messageTrails.add(comet);
    state.flyingMessages.push(comet);
    
    // Limit total messages
    while (state.flyingMessages.length > 80) {
        const old = state.flyingMessages.shift();
        messageTrails.remove(old);
        // Dispose all materials in the group
        old.traverse(child => {
            if (child.material) {
                if (child.material.map && child.material.map !== glowTexture) {
                    child.material.map.dispose();
                }
                child.material.dispose();
            }
            if (child.geometry) child.geometry.dispose();
        });
    }
}

// ============== VIBE EXPLOSIONS ==============

function createVibeExplosion(vibeType, messageText) {
    const color = vibeType === 'funny' ? COLORS.funny : COLORS.uplifting;
    const emoji = vibeType === 'funny' ? '😂' : '💖';
    const label = vibeType === 'funny' ? 'FUNNY' : 'UPLIFTING';
    
    // Random position in view
    const origin = new THREE.Vector3(
        (Math.random() - 0.5) * 80,
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 80
    );
    
    // Create floating label that shows what triggered it
    const labelCanvas = document.createElement('canvas');
    const labelCtx = labelCanvas.getContext('2d');
    labelCanvas.width = 512;
    labelCanvas.height = 256;
    
    // Background
    labelCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    labelCtx.beginPath();
    labelCtx.roundRect(10, 10, 492, 236, 20);
    labelCtx.fill();
    
    // Border glow
    labelCtx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    labelCtx.lineWidth = 4;
    labelCtx.shadowColor = `#${color.toString(16).padStart(6, '0')}`;
    labelCtx.shadowBlur = 20;
    labelCtx.stroke();
    
    // Emoji and label
    labelCtx.font = 'bold 48px -apple-system, sans-serif';
    labelCtx.textAlign = 'center';
    labelCtx.fillStyle = 'white';
    labelCtx.fillText(`${emoji} ${label}`, 256, 70);
    
    // Message preview (truncated)
    labelCtx.font = '28px -apple-system, sans-serif';
    labelCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    const preview = messageText && messageText.length > 40 
        ? messageText.slice(0, 40) + '...' 
        : (messageText || '');
    labelCtx.fillText(preview, 256, 140);
    
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelMaterial = new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        opacity: 1
    });
    
    const labelSprite = new THREE.Sprite(labelMaterial);
    labelSprite.scale.set(40, 20, 1);
    labelSprite.position.copy(origin);
    labelSprite.position.y += 15;  // Float above explosion
    
    labelSprite.userData = {
        life: 0,
        maxLife: 180  // 3 seconds at 60fps
    };
    
    scene.add(labelSprite);
    state.vibeParticles.push(labelSprite);
    
    // Create particle burst
    const particleCount = 150;  // More particles
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];
    
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = origin.x;
        positions[i * 3 + 1] = origin.y;
        positions[i * 3 + 2] = origin.z;
        
        // Spherical burst
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const speed = 1 + Math.random() * 2;
        
        velocities.push(new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta) * speed,
            Math.sin(phi) * Math.sin(theta) * speed,
            Math.cos(phi) * speed
        ));
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
        color: color,
        size: 5,  // Bigger particles
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending
    });
    
    const particles = new THREE.Points(geometry, material);
    particles.userData = {
        velocities: velocities,
        life: 0,
        maxLife: 120,
        isParticles: true
    };
    
    scene.add(particles);
    state.vibeParticles.push(particles);
}

// ============== ANIMATION LOOP ==============

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    const elapsed = clock.getElapsedTime();
    
    // Rotate starfield slowly
    if (starfield) {
        starfield.rotation.y += delta * 0.01;
    }
    
    // Animate nebula shader
    if (nebula && nebula.material.uniforms) {
        nebula.material.uniforms.time.value = elapsed;
        nebula.rotation.y -= delta * 0.003;  // Very slow rotation
    }
    
    // Animate ticker orbs
    tickerOrbs.children.forEach(orb => {
        const data = orb.userData;
        
        // Birth animation - grow from tiny to full size
        if (data.isBirthing) {
            data.birthProgress++;
            const t = data.birthProgress / data.birthDuration;
            
            if (t >= 1) {
                // Birth complete
                data.isBirthing = false;
            } else {
                // Elastic ease-out for satisfying "pop" into existence
                const easeOut = 1 - Math.pow(1 - t, 3);  // Cubic ease out
                const overshoot = 1 + Math.sin(t * Math.PI) * 0.2;  // Slight overshoot
                const birthScale = easeOut * overshoot * data.targetScale;
                orb.scale.setScalar(Math.max(0.01, birthScale));
                
                // Skip normal scale logic during birth
                // But still do orbit/bob/rotate
            }
        } else {
            // Normal smooth scale transition (after birth)
            const currentScale = orb.scale.x;
            const targetScale = data.targetScale;
            const newScale = currentScale + (targetScale - currentScale) * delta * 2;
            orb.scale.setScalar(newScale);
            // No pulse effect - just smooth scaling
        }
        
        // Orbit around center
        data.orbitAngle += data.orbitSpeed;
        orb.position.x = Math.cos(data.orbitAngle) * data.orbitRadius;
        orb.position.z = Math.sin(data.orbitAngle) * data.orbitRadius;
        
        // Gentle bobbing
        orb.position.y = data.baseY + Math.sin(elapsed + data.bobOffset) * 2;
        
        // Rotate
        orb.rotation.y += delta * 0.5;
        
        // Scale label based on camera distance (LOD)
        const label = orb.children.find(c => c.isSprite);
        if (label) {
            const distToCamera = orb.position.distanceTo(camera.position);
            // Fade out labels when far away to reduce clutter
            const labelOpacity = Math.max(0, Math.min(1, 1 - (distToCamera - 80) / 150));
            label.material.opacity = labelOpacity;
            // Scale labels larger when far to stay readable
            const labelScale = Math.max(8, Math.min(15, distToCamera / 10));
            label.scale.set(labelScale, labelScale / 4, 1);
        }
    });
    
    // Animate flying message comets
    for (let i = state.flyingMessages.length - 1; i >= 0; i--) {
        const comet = state.flyingMessages[i];
        const data = comet.userData;
        data.life++;
        
        // Move toward center
        comet.position.add(data.direction.clone().multiplyScalar(data.speed));
        
        // Keep comet oriented toward direction of travel
        comet.lookAt(
            comet.position.x + data.direction.x,
            comet.position.y + data.direction.y,
            comet.position.z + data.direction.z
        );
        
        // Fade in/out
        const lifeRatio = data.life / data.maxLife;
        let opacity;
        if (lifeRatio < 0.1) {
            opacity = lifeRatio * 10;  // Fade in
        } else if (lifeRatio > 0.7) {
            opacity = (1 - lifeRatio) * 3.33;  // Fade out
        } else {
            opacity = 1;
        }
        
        // Apply opacity to text trail
        if (data.textSprite) {
            data.textSprite.material.opacity = opacity * 0.9;
        }
        
        // Apply to orb and glow
        if (data.orb) {
            data.orb.material.opacity = opacity * 0.9;
        }
        if (data.glowSprite) {
            data.glowSprite.material.opacity = opacity * 0.7;
        }
        
        // Fade trail particles
        comet.children.forEach(child => {
            if (child.name === 'trail') {
                const baseOpacity = parseFloat(child.userData.baseOpacity || child.material.opacity / opacity || 0.3);
                child.userData.baseOpacity = baseOpacity;
                child.material.opacity = baseOpacity * opacity;
            }
        });
        
        // Remove when done
        if (data.life >= data.maxLife) {
            messageTrails.remove(comet);
            comet.traverse(child => {
                if (child.material) {
                    if (child.material.map && child.material.map !== glowTexture) {
                        child.material.map.dispose();
                    }
                    child.material.dispose();
                }
                if (child.geometry) child.geometry.dispose();
            });
            state.flyingMessages.splice(i, 1);
        }
    }
    
    // Animate vibe particles and labels
    state.vibeParticles.forEach((obj, index) => {
        const data = obj.userData;
        data.life++;
        
        if (data.isParticles) {
            // Particle system animation
            const positions = obj.geometry.attributes.position.array;
            for (let i = 0; i < data.velocities.length; i++) {
                positions[i * 3] += data.velocities[i].x;
                positions[i * 3 + 1] += data.velocities[i].y;
                positions[i * 3 + 2] += data.velocities[i].z;
                
                // Slow down
                data.velocities[i].multiplyScalar(0.97);
            }
            obj.geometry.attributes.position.needsUpdate = true;
            
            // Fade out
            obj.material.opacity = 1 - (data.life / data.maxLife);
            
            // Remove when done
            if (data.life >= data.maxLife) {
                scene.remove(obj);
                obj.geometry.dispose();
                obj.material.dispose();
                state.vibeParticles.splice(index, 1);
            }
        } else {
            // Label sprite animation - float up and fade
            obj.position.y += 0.1;
            
            // Fade out in last third of life
            if (data.life > data.maxLife * 0.6) {
                const fadeProgress = (data.life - data.maxLife * 0.6) / (data.maxLife * 0.4);
                obj.material.opacity = 1 - fadeProgress;
            }
            
            // Remove when done
            if (data.life >= data.maxLife) {
                scene.remove(obj);
                obj.material.dispose();
                state.vibeParticles.splice(index, 1);
            }
        }
    });
    
    // Auto-rotate camera slowly when not dragging
    if (!isDragging && state.connected) {
        cameraTheta += delta * 0.008;  // Slower rotation
        updateCameraPosition();
    }
    
    // Animate central core pulsing
    if (centralCore) {
        const pulse = 0.8 + Math.sin(elapsed * 2) * 0.2;
        centralCore.material.opacity = pulse;
        centralCore.scale.setScalar(1 + Math.sin(elapsed * 1.5) * 0.05);
    }
    
    // Animate core glow layers and energy rings
    coreGlows.forEach((glow, i) => {
        if (glow.userData.isEnergyRing) {
            glow.rotation.z += delta * glow.userData.rotationSpeed;
            glow.rotation.x += delta * 0.05;
        } else if (glow.userData.isCoreGlow) {
            // Pulsing core glow sprite
            const pulse = 0.6 + Math.sin(elapsed * 1.5) * 0.2;
            glow.material.opacity = pulse;
            const scale = 55 + Math.sin(elapsed * 2) * 5;
            glow.scale.set(scale, scale, 1);
        } else {
            // Pulsing glow sphere layers
            const baseOpacity = [0.5, 0.35, 0.2, 0.12, 0.06][i] || 0.1;
            glow.material.opacity = baseOpacity + Math.sin(elapsed * 2 + i * 0.5) * 0.1;
        }
    });
    
    renderer.render(scene, camera);
}

// ============== WEBSOCKET ==============

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 2000;
let pingInterval = null;

function connectToStream(videoId) {
    console.log('[Universe] connectToStream called with:', videoId);
    console.log('[Universe] Backend URL:', BACKEND_URL);
    
    // Clear any existing ping interval
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    
    if (state.ws) {
        state.ws.close();
    }
    
    try {
        state.ws = new WebSocket(BACKEND_URL);
        console.log('[Universe] WebSocket created');
    } catch (e) {
        console.error('[Universe] WebSocket creation error:', e);
        scheduleReconnect(videoId);
        return;
    }
    
    state.ws.onopen = () => {
        console.log('[Universe] WebSocket connected');
        reconnectAttempts = 0;  // Reset on successful connection
        state.ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            videoId: videoId
        }));
        
        // Start keepalive ping every 30 seconds
        pingInterval = setInterval(() => {
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ type: 'ping' }));
                console.log('[Universe] Sent keepalive ping');
            }
        }, 30000);
    };
    
    state.ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
        } catch (e) {
            console.error('[Universe] Parse error:', e);
        }
    };
    
    state.ws.onerror = (e) => {
        console.error('[Universe] WebSocket error:', e);
    };
    
    state.ws.onclose = (e) => {
        console.log('[Universe] WebSocket closed, code:', e.code, 'reason:', e.reason);
        state.connected = false;
        setStatus(false);
        
        // Clear ping interval
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
        
        // Auto-reconnect if we had a video ID
        if (state.videoId) {
            scheduleReconnect(state.videoId);
        }
    };
}

function scheduleReconnect(videoId) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('[Universe] Max reconnect attempts reached');
        document.getElementById('connect-btn').disabled = false;
        document.getElementById('connect-btn').textContent = 'Reconnect';
        return;
    }
    
    reconnectAttempts++;
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1), 30000);
    
    console.log(`[Universe] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    
    // Update status to show reconnecting
    const text = document.getElementById('status-text');
    if (text) {
        text.textContent = `Reconnecting... (${reconnectAttempts})`;
    }
    
    setTimeout(() => {
        if (state.videoId) {
            connectToStream(videoId);
        }
    }, delay);
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'subscribed':
            console.log('[Universe] Subscribed to:', msg.videoId);
            state.connected = true;
            state.videoId = msg.videoId;
            setStatus(true);
            hideOverlay();
            document.getElementById('ticker-legend').style.display = 'flex';
            break;
            
        case 'message':
            processMessage(msg.data);
            break;
            
        case 'vibe':
            processVibe(msg.data);
            break;
            
        case 'pulse':
            // Could display pulses in HUD
            console.log('[Universe] Pulse:', msg.data.summary);
            break;
            
        case 'error':
            console.error('[Universe] Error:', msg.message);
            break;
    }
}

function processMessage(msg) {
    const now = Date.now();
    state.recentMessages.push(now);
    
    // Create flying message
    createFlyingMessage(msg.text, msg.sentiment, msg.isQuestion, !!msg.topic);
    
    // Update ticker if present
    if (msg.topic) {
        const existing = state.tickers[msg.topic] || { count: 0, sentiment: { bullish: 0, bearish: 0, neutral: 0 } };
        
        updateTickerOrb(msg.topic, {
            count: existing.count + 1,
            sentiment: {
                ...existing.sentiment,
                [msg.sentiment]: (existing.sentiment[msg.sentiment] || 0) + 1
            }
        });
        
        state.tickers[msg.topic].count = existing.count + 1;
        state.tickers[msg.topic].sentiment = {
            ...existing.sentiment,
            [msg.sentiment]: (existing.sentiment[msg.sentiment] || 0) + 1
        };
    }
}

function processVibe(msg) {
    if (msg.vibe) {
        createVibeExplosion(msg.vibe, msg.text || msg.message || '');
    }
}

// ============== UI ==============

function extractVideoId(input) {
    if (!input) return null;
    input = input.trim();
    
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
    
    const patterns = [
        /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:embed\/)([a-zA-Z0-9_-]{11})/,
        /(?:live\/)([a-zA-Z0-9_-]{11})/
    ];
    
    for (const p of patterns) {
        const m = input.match(p);
        if (m) return m[1];
    }
    
    return null;
}

function handleConnect() {
    console.log('[Universe] handleConnect called');
    
    const input = document.getElementById('video-input').value || initialVideoId;
    console.log('[Universe] Input:', input);
    
    const videoId = extractVideoId(input);
    console.log('[Universe] Extracted videoId:', videoId);
    
    if (!videoId) {
        document.getElementById('connect-btn').textContent = 'Invalid URL';
        setTimeout(() => {
            document.getElementById('connect-btn').textContent = 'Enter';
        }, 2000);
        return;
    }
    
    document.getElementById('connect-btn').disabled = true;
    document.getElementById('connect-btn').textContent = 'Connecting...';
    
    state.videoId = videoId;
    connectToStream(videoId);
}

function hideOverlay() {
    document.getElementById('connect-overlay').classList.add('hidden');
}

function setStatus(connected) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    
    if (connected) {
        dot.classList.add('connected');
        text.textContent = `Connected to ${state.videoId}`;
    } else {
        dot.classList.remove('connected');
        text.textContent = 'Disconnected';
    }
}

function calculateVelocity() {
    const now = Date.now();
    state.recentMessages = state.recentMessages.filter(t => now - t < 5000);
    state.velocity = state.recentMessages.length / 5;
    
    document.getElementById('velocity-value').textContent = state.velocity.toFixed(1);
}

// ============== START ==============

document.addEventListener('DOMContentLoaded', init);
