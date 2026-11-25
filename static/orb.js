const DRAG_THRESHOLD_PX = 4;
const element = document.getElementById('orb');
const logo = document.getElementById('logo');
const mascot = document.getElementById('mascot');
const mascotContext = mascot.getContext('2d');

window.orb.onMascotFrame((frame) => {
    mascot.hidden = !frame;
    logo.hidden = Boolean(frame);
    element.classList.toggle('mascot', Boolean(frame));
    element.style.backgroundColor = frame ? frame.background : '';
    if (!frame) {
        return;
    }
    if (mascot.width !== frame.width || mascot.height !== frame.height) {
        mascot.width = frame.width;
        mascot.height = frame.height;
    }
    mascotContext.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
});

window.orb.onPlaySound((url) => {
    new Audio(url).play().catch((error) => console.error('Could not play the sound', url, error));
});

let start = null;
let dragging = false;

element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
        return;
    }
    element.setPointerCapture(event.pointerId);
    start = { x: event.screenX, y: event.screenY };
    dragging = false;
});

element.addEventListener('pointermove', (event) => {
    if (!start || dragging) {
        return;
    }
    if (Math.hypot(event.screenX - start.x, event.screenY - start.y) >= DRAG_THRESHOLD_PX) {
        dragging = true;
        element.classList.add('dragging');
        window.orb.dragStart();
    }
});

function release() {
    if (!start) {
        return;
    }
    if (dragging) {
        window.orb.dragEnd();
    } else {
        window.orb.click();
    }
    start = null;
    dragging = false;
    element.classList.remove('dragging');
}

element.addEventListener('pointerup', release);
element.addEventListener('lostpointercapture', release);
