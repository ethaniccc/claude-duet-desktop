const DRAG_THRESHOLD_PX = 4;
const element = document.getElementById('orb');
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
