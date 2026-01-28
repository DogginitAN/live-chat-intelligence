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
    // Create a subtle nebula effect with particles
    const nebulaGeometry = new THREE.BufferGeometry();
    const nebulaCount = 200;
    const positions = new Float32Array(nebulaCount * 3);
    const colors = new Float32Array(nebulaCount * 3);
    
    for (let i = 0; i < nebulaCount; i++) {
        const i3 = i * 3;
        
        // Cluster around origin
        positions[i3] = (Math.random() - 0.5) * 300;
        positions[i3 + 1] = (Math.random() - 0.5) * 200;
        positions[i3 + 2] = (Math.random() - 0.5) * 300;
        
        // Purple/blue tones
        const hue = 0.6 + Math.random() * 0.2;
        const color = new THREE.Color().setHSL(hue, 0.8, 0.5);
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;
    }
    
    nebulaGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    nebulaGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const nebulaMaterial = new THREE.PointsMaterial({
        size: 30,
        vertexColors: true,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending
    });
    
    nebula = new THREE.Points(nebulaGeometry, nebulaMaterial);
    scene.add(nebula);
}

let centralCore, coreGlows = [];

function createCentralCore() {
    // Glowing central core where tickers orbit
    const coreGeometry = new THREE.SphereGeometry(5, 32, 32);
    const coreMaterial = new THREE.MeshBasicMaterial({
        color: 0x6080ff,
        transparent: true,
        opacity: 0.8
    });
    centralCore = new THREE.Mesh(coreGeometry, coreMaterial);
    scene.add(centralCore);
    
    // Multiple glow layers for bloom effect
    const glowSizes = [8, 12, 18, 25];
    const glowOpacities = [0.4, 0.25, 0.15, 0.08];
    
    glowSizes.forEach((size, i) => {
        const glowGeometry = new THREE.SphereGeometry(size, 32, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0x4060ff,
            transparent: true,
            opacity: glowOpacities[i],
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        coreGlows.push(glow);
        scene.add(glow);
    });
    
    // Add a bright point light at core
    const coreLight = new THREE.PointLight(0x4060ff, 2, 100);
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
    
    // Create sprite with LARGER text
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1024;  // Bigger canvas
    canvas.height = 128;
    
    // Truncate text
    const maxLen = 60;
    const displayText = text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
    
    // Background pill for readability
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    const textWidth = ctx.measureText(displayText).width || 600;
    ctx.beginPath();
    ctx.roundRect(5, 20, Math.min(textWidth + 40, 1000), 88, 20);
    ctx.fill();
    
    ctx.font = 'bold 42px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    // Glow effect
    ctx.shadowColor = `#${color.toString(16).padStart(6, '0')}`;
    ctx.shadowBlur = 15;
    ctx.fillStyle = 'white';
    ctx.fillText(displayText, 25, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(60, 7.5, 1);  // Much larger scale
    
    // Start from random position far away
    const startAngle = Math.random() * Math.PI * 2;
    const startRadius = 200 + Math.random() * 100;
    const startY = (Math.random() - 0.5) * 100;
    
    sprite.position.set(
        Math.cos(startAngle) * startRadius,
        startY,
        Math.sin(startAngle) * startRadius
    );
    
    // Calculate direction toward center (with some variance)
    const targetX = (Math.random() - 0.5) * 30;
    const targetY = (Math.random() - 0.5) * 30;
    const targetZ = (Math.random() - 0.5) * 30;
    
    const direction = new THREE.Vector3(
        targetX - sprite.position.x,
        targetY - sprite.position.y,
        targetZ - sprite.position.z
    ).normalize();
    
    sprite.userData = {
        direction: direction,
        speed: 0.3 + Math.random() * 0.2,  // Slower movement
        life: 0,
        maxLife: 500 + Math.random() * 200  // ~8-12 seconds at 60fps
    };
    
    messageTrails.add(sprite);
    state.flyingMessages.push(sprite);
    
    // Limit total messages
    while (state.flyingMessages.length > 100) {
        const old = state.flyingMessages.shift();
        messageTrails.remove(old);
        old.material.dispose();
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
    
    // Pulse nebula
    if (nebula) {
        nebula.rotation.y -= delta * 0.005;
        nebula.material.opacity = 0.08 + Math.sin(elapsed * 0.5) * 0.02;
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
    
    // Animate flying messages
    state.flyingMessages.forEach((sprite, index) => {
        const data = sprite.userData;
        data.life++;
        
        // Move toward center
        sprite.position.add(data.direction.clone().multiplyScalar(data.speed));
        
        // Fade in/out
        const lifeRatio = data.life / data.maxLife;
        if (lifeRatio < 0.1) {
            sprite.material.opacity = lifeRatio * 10;
        } else if (lifeRatio > 0.7) {
            sprite.material.opacity = (1 - lifeRatio) * 3.33;
        } else {
            sprite.material.opacity = 1;
        }
        
        // Remove when done
        if (data.life >= data.maxLife) {
            messageTrails.remove(sprite);
            sprite.material.dispose();
            state.flyingMessages.splice(index, 1);
        }
    });
    
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
        } else {
            // Pulsing glow layers
            const baseopacity = [0.4, 0.25, 0.15, 0.08][i] || 0.1;
            glow.material.opacity = baseopacity + Math.sin(elapsed * 2 + i * 0.5) * 0.1;
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
