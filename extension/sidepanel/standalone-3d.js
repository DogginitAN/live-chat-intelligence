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
    initThree();
    initControls();
    initWebSocket();
    animate();
    
    // UI event listeners
    document.getElementById('connect-btn').addEventListener('click', handleConnect);
    document.getElementById('video-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleConnect();
    });
    
    // Velocity calculator
    setInterval(calculateVelocity, 500);
    
    // Auto-connect if video ID provided
    if (initialVideoId) {
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
    const starCount = 5000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    
    for (let i = 0; i < starCount; i++) {
        const i3 = i * 3;
        
        // Distribute in a sphere
        const radius = 500 + Math.random() * 500;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        
        positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i3 + 2] = radius * Math.cos(phi);
        
        // Vary star colors slightly
        const brightness = 0.5 + Math.random() * 0.5;
        colors[i3] = brightness;
        colors[i3 + 1] = brightness;
        colors[i3 + 2] = brightness + Math.random() * 0.2;
    }
    
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const starsMaterial = new THREE.PointsMaterial({
        size: 1.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.8
    });
    
    starfield = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starfield);
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

function createCentralCore() {
    // Glowing central core where tickers orbit
    const coreGeometry = new THREE.SphereGeometry(5, 32, 32);
    const coreMaterial = new THREE.MeshBasicMaterial({
        color: 0x4060ff,
        transparent: true,
        opacity: 0.3
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    scene.add(core);
    
    // Core glow
    const glowGeometry = new THREE.SphereGeometry(8, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0x4060ff,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    scene.add(glow);
}

// ============== TICKER ORBS ==============

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
    
    // Position in orbit around center
    const angle = Math.random() * Math.PI * 2;
    const radius = 30 + Math.random() * 40;
    const height = (Math.random() - 0.5) * 30;
    
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
    
    // Add text label
    const label = createTextLabel(ticker);
    label.position.y = 5;
    orb.add(label);
    
    // Store metadata
    orb.userData = {
        ticker: ticker,
        orbitAngle: angle,
        orbitRadius: radius,
        orbitSpeed: 0.001 + Math.random() * 0.002,
        baseY: height,
        bobOffset: Math.random() * Math.PI * 2,
        targetScale: 1
    };
    
    tickerOrbs.add(orb);
    return orb;
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
    
    // Scale grows logarithmically with mentions
    const scale = 1 + Math.log10(data.count + 1) * 0.8;
    orbData.orb.userData.targetScale = scale;
    
    // Update color based on sentiment
    const sentiment = getSentiment(data.sentiment);
    const color = COLORS[sentiment];
    orbData.orb.material.color.setHex(color);
    orbData.orb.material.emissive.setHex(color);
    
    // Pulse effect on update
    orbData.orb.userData.pulseTime = clock.getElapsedTime();
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
    
    // Create sprite
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 48;
    
    // Truncate text
    const maxLen = 50;
    const displayText = text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
    
    ctx.font = '20px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    // Glow effect
    ctx.shadowColor = `#${color.toString(16).padStart(6, '0')}`;
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'white';
    ctx.fillText(displayText, 10, 24);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(25, 2.5, 1);
    
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
        speed: 0.5 + Math.random() * 0.3,
        life: 0,
        maxLife: 200 + Math.random() * 100
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

function createVibeExplosion(vibeType) {
    const color = vibeType === 'funny' ? COLORS.funny : COLORS.uplifting;
    
    const particleCount = 100;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];
    
    // Random position in view
    const origin = new THREE.Vector3(
        (Math.random() - 0.5) * 80,
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 80
    );
    
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = origin.x;
        positions[i * 3 + 1] = origin.y;
        positions[i * 3 + 2] = origin.z;
        
        // Random outward velocity
        velocities.push(new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        ));
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
        color: color,
        size: 3,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending
    });
    
    const particles = new THREE.Points(geometry, material);
    particles.userData = {
        velocities: velocities,
        life: 0,
        maxLife: 120
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
        
        // Orbit around center
        data.orbitAngle += data.orbitSpeed;
        orb.position.x = Math.cos(data.orbitAngle) * data.orbitRadius;
        orb.position.z = Math.sin(data.orbitAngle) * data.orbitRadius;
        
        // Gentle bobbing
        orb.position.y = data.baseY + Math.sin(elapsed + data.bobOffset) * 2;
        
        // Smooth scale transition
        const currentScale = orb.scale.x;
        const targetScale = data.targetScale;
        const newScale = currentScale + (targetScale - currentScale) * delta * 2;
        orb.scale.setScalar(newScale);
        
        // Pulse effect after mention
        if (data.pulseTime) {
            const pulseAge = elapsed - data.pulseTime;
            if (pulseAge < 0.5) {
                const pulseScale = 1 + Math.sin(pulseAge * Math.PI * 4) * 0.2;
                orb.scale.multiplyScalar(pulseScale);
            }
        }
        
        // Rotate
        orb.rotation.y += delta * 0.5;
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
    
    // Animate vibe particles
    state.vibeParticles.forEach((particles, index) => {
        const data = particles.userData;
        data.life++;
        
        // Update positions
        const positions = particles.geometry.attributes.position.array;
        for (let i = 0; i < data.velocities.length; i++) {
            positions[i * 3] += data.velocities[i].x;
            positions[i * 3 + 1] += data.velocities[i].y;
            positions[i * 3 + 2] += data.velocities[i].z;
            
            // Slow down
            data.velocities[i].multiplyScalar(0.98);
        }
        particles.geometry.attributes.position.needsUpdate = true;
        
        // Fade out
        particles.material.opacity = 1 - (data.life / data.maxLife);
        
        // Remove when done
        if (data.life >= data.maxLife) {
            scene.remove(particles);
            particles.geometry.dispose();
            particles.material.dispose();
            state.vibeParticles.splice(index, 1);
        }
    });
    
    // Auto-rotate camera slowly when not dragging
    if (!isDragging && state.connected) {
        cameraTheta += delta * 0.02;
        updateCameraPosition();
    }
    
    renderer.render(scene, camera);
}

// ============== WEBSOCKET ==============

function initWebSocket() {
    // Will connect when user clicks Enter
}

function connectToStream(videoId) {
    if (state.ws) {
        state.ws.close();
    }
    
    state.ws = new WebSocket(BACKEND_URL);
    
    state.ws.onopen = () => {
        console.log('[Universe] WebSocket connected');
        state.ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            videoId: videoId
        }));
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
        setStatus(false);
    };
    
    state.ws.onclose = () => {
        console.log('[Universe] WebSocket closed');
        state.connected = false;
        setStatus(false);
    };
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
        createVibeExplosion(msg.vibe);
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
    const input = document.getElementById('video-input').value || initialVideoId;
    const videoId = extractVideoId(input);
    
    if (!videoId) {
        alert('Invalid YouTube URL or video ID');
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
