// ---- Config constants (tweak freely) ----
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;

const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 80;
const PADDLE_MARGIN = 20;   // distance from paddle to canvas edge
const PADDLE_SPEED = 400;   // pixels per second

const BALL_RADIUS = 8;
const BALL_SPEED_X = 250;   // serve speed, pixels per second (horizontal)
const BALL_SPEED_Y = 150;   // serve speed, pixels per second (vertical)
const BALL_SPEED_UP = 1.05; // ball speed multiplier on every paddle hit
const MAX_BALL_SPEED = 800; // cap so the ball can't tunnel through paddles
const MAX_BOUNCE_ANGLE = Math.PI / 3; // 60°: angle when hitting a paddle's very tip

const WIN_SCORE = 7;
const SERVE_DELAY = 1;      // seconds the ball waits at centre after a point
const MAX_DELTA = 0.05;     // clamp huge frames (e.g. after switching tabs)

const RIGHT_PADDLE_AI = false; // true = computer controls the right paddle
const AI_SPEED = 300;          // AI paddle speed (lower = easier)

// Which keys move which paddle (uses event.code, so keyboard layout doesn't matter)
const CONTROLS = {
  left:  { up: 'KeyW',    down: 'KeyS' },
  right: { up: 'ArrowUp', down: 'ArrowDown' },
};

class Paddle {
  constructor(x, y, width, height, speed) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.speed = speed;
    this.direction = 0; // -1 = up, 0 = still, 1 = down
  }

  get centerY() {
    return this.y + this.height / 2;
  }

  move(deltaTime, canvasHeight) {
    this.y += this.direction * this.speed * deltaTime;

    // Keep the paddle fully inside the canvas.
    if (this.y < 0) this.y = 0;
    if (this.y + this.height > canvasHeight) this.y = canvasHeight - this.height;
  }

  draw(ctx) {
    ctx.fillStyle = 'white';
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
}

class Ball {
  constructor(x, y, radius, vx, vy) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.vx = vx; // horizontal velocity, px/sec
    this.vy = vy; // vertical velocity, px/sec
  }

  move(deltaTime) {
    // distance = speed * time
    this.x += this.vx * deltaTime;
    this.y += this.vy * deltaTime;
  }

  bounceOffWalls(canvasHeight) {
    // Top wall: the ball's top edge (y - radius) has gone above 0.
    if (this.y - this.radius < 0) {
      this.y = this.radius;         // put it back so it's just touching the wall
      this.vy = Math.abs(this.vy);  // force it to move down (positive)
    }

    // Bottom wall: the ball's bottom edge (y + radius) has gone past the canvas.
    if (this.y + this.radius > canvasHeight) {
      this.y = canvasHeight - this.radius;
      this.vy = -Math.abs(this.vy); // force it to move up (negative)
    }
  }

  // Circle-vs-rectangle overlap: find the point on the paddle closest to the
  // ball's centre, then check if that point is within the ball's radius.
  collidesWith(paddle) {
    const closestX = Math.max(paddle.x, Math.min(this.x, paddle.x + paddle.width));
    const closestY = Math.max(paddle.y, Math.min(this.y, paddle.y + paddle.height));
    const dx = this.x - closestX;
    const dy = this.y - closestY;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }

  // Bounce off a paddle. `direction` is +1 to send the ball right, -1 for left.
  // The further from the paddle's centre the ball hits, the steeper the angle.
  bounceOffPaddle(paddle, direction) {
    let offset = (this.y - paddle.centerY) / (paddle.height / 2); // -1 (top) .. 1 (bottom)
    offset = Math.max(-1, Math.min(1, offset));
    const angle = offset * MAX_BOUNCE_ANGLE;

    const speed = Math.min(Math.hypot(this.vx, this.vy) * BALL_SPEED_UP, MAX_BALL_SPEED);
    this.vx = direction * speed * Math.cos(angle);
    this.vy = speed * Math.sin(angle);

    // Push the ball out of the paddle so it can't collide again next frame.
    if (direction > 0) {
      this.x = paddle.x + paddle.width + this.radius;
    } else {
      this.x = paddle.x - this.radius;
    }
  }

  draw(ctx) {
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Game {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.canvas.width = CANVAS_WIDTH;   // constants are the single source of truth
    this.canvas.height = CANVAS_HEIGHT;
    this.ctx = this.canvas.getContext('2d');
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    this.leftPaddle = null;
    this.rightPaddle = null;
    this.ball = null;

    this.leftScore = 0;
    this.rightScore = 0;
    this.winner = null;     // 'Left' | 'Right' once someone wins
    this.serveTimer = 0;    // counts down while the ball waits at centre

    // 'ready' -> 'playing' <-> 'paused', 'playing' -> 'gameover' -> 'ready'
    this.state = 'ready';

    this.keysDown = new Set();

    this.lastTimestamp = null;
    this.rafId = null;
    this.running = false;

    // Bind once so we can pass these straight to the browser without losing `this`.
    this.loop = this.loop.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
  }

  init() {
    this.createEntities();
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.start();
  }

  createEntities() {
    const paddleY = (this.height - PADDLE_HEIGHT) / 2;

    this.leftPaddle = new Paddle(
      PADDLE_MARGIN,
      paddleY,
      PADDLE_WIDTH,
      PADDLE_HEIGHT,
      PADDLE_SPEED
    );
    this.rightPaddle = new Paddle(
      this.width - PADDLE_MARGIN - PADDLE_WIDTH,
      paddleY,
      PADDLE_WIDTH,
      PADDLE_HEIGHT,
      RIGHT_PADDLE_AI ? AI_SPEED : PADDLE_SPEED
    );
    this.ball = new Ball(this.width / 2, this.height / 2, BALL_RADIUS, 0, 0);
  }

  // ---- Input ----

  handleKeyDown(event) {
    const gameKeys = ['ArrowUp', 'ArrowDown', 'Space'];
    if (gameKeys.includes(event.code)) event.preventDefault(); // stop page scrolling

    this.keysDown.add(event.code);

    if (event.code === 'Space') {
      if (this.state === 'ready') this.newGame();
      else if (this.state === 'gameover') this.state = 'ready';
    }

    // P or Escape: pause / resume.
    if (event.code === 'KeyP' || event.code === 'Escape') {
      if (this.state === 'playing') this.state = 'paused';
      else if (this.state === 'paused') this.state = 'playing';
      else if (this.state === 'gameover' && event.code === 'Escape') this.quitToTitle();
    }

    // Q while paused: abandon the match and go back to the title screen.
    if (event.code === 'KeyQ' && this.state === 'paused') {
      this.quitToTitle();
    }
  }

  quitToTitle() {
    this.leftScore = 0;
    this.rightScore = 0;
    this.winner = null;
    this.keysDown.clear();
    this.createEntities(); // paddles back to the middle, ball reset
    this.state = 'ready';
  }

  handleKeyUp(event) {
    this.keysDown.delete(event.code);
  }

  // Turns held keys into -1 / 0 / 1 (holding both = 0).
  readDirection(keys) {
    let direction = 0;
    if (this.keysDown.has(keys.up)) direction -= 1;
    if (this.keysDown.has(keys.down)) direction += 1;
    return direction;
  }

  // Simple AI: follow the ball when it's coming towards us, otherwise drift
  // back to the middle. The dead zone stops the paddle jittering.
  aiDirection(paddle) {
    const deadZone = 10;
    const targetY = this.ball.vx > 0 ? this.ball.y : this.height / 2;
    if (targetY < paddle.centerY - deadZone) return -1;
    if (targetY > paddle.centerY + deadZone) return 1;
    return 0;
  }

  // ---- Game flow ----

  newGame() {
    this.leftScore = 0;
    this.rightScore = 0;
    this.winner = null;
    this.createEntities();
    this.serve(Math.random() < 0.5 ? -1 : 1);
    this.state = 'playing';
  }

  // Put the ball in the centre and send it towards `direction` (+1 right, -1 left)
  // after a short delay.
  serve(direction) {
    this.ball.x = this.width / 2;
    this.ball.y = this.height / 2;
    this.ball.vx = direction * BALL_SPEED_X;
    this.ball.vy = (Math.random() < 0.5 ? -1 : 1) * BALL_SPEED_Y;
    this.serveTimer = SERVE_DELAY;
  }

  scorePoint(side) {
    if (side === 'left') this.leftScore++;
    else this.rightScore++;

    if (this.leftScore >= WIN_SCORE || this.rightScore >= WIN_SCORE) {
      this.winner = this.leftScore > this.rightScore ? 'Left' : 'Right';
      this.state = 'gameover';
      return;
    }

    // Serve towards the player who just lost the point.
    this.serve(side === 'left' ? 1 : -1);
  }

  // ---- Loop ----

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = null; // avoid a giant first frame after stop()/start()
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  loop(timestamp) {
    if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
    let deltaTime = (timestamp - this.lastTimestamp) / 1000; // seconds
    deltaTime = Math.min(deltaTime, MAX_DELTA);
    this.lastTimestamp = timestamp;

    this.update(deltaTime);
    this.render();

    if (this.running) {
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  update(deltaTime) {
    if (this.state !== 'playing') return;

    // Paddles
    this.leftPaddle.direction = this.readDirection(CONTROLS.left);
    this.rightPaddle.direction = RIGHT_PADDLE_AI
      ? this.aiDirection(this.rightPaddle)
      : this.readDirection(CONTROLS.right);
    this.leftPaddle.move(deltaTime, this.height);
    this.rightPaddle.move(deltaTime, this.height);

    // Ball waits at centre during the serve delay (paddles can still move).
    if (this.serveTimer > 0) {
      this.serveTimer -= deltaTime;
      return;
    }

    this.ball.move(deltaTime);
    this.ball.bounceOffWalls(this.height);

    // Only bounce off a paddle if the ball is moving towards it.
    // Otherwise it can get stuck inside, flipping direction every frame.
    if (this.ball.vx < 0 && this.ball.collidesWith(this.leftPaddle)) {
      this.ball.bounceOffPaddle(this.leftPaddle, 1);
    } else if (this.ball.vx > 0 && this.ball.collidesWith(this.rightPaddle)) {
      this.ball.bounceOffPaddle(this.rightPaddle, -1);
    }

    // Ball fully off the left/right edge = point for the other side.
    if (this.ball.x + this.ball.radius < 0) {
      this.scorePoint('right');
    } else if (this.ball.x - this.ball.radius > this.width) {
      this.scorePoint('left');
    }
  }

  // ---- Drawing ----

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawCenterLine();
    this.drawScores();

    this.leftPaddle.draw(ctx);
    this.rightPaddle.draw(ctx);
    if (this.state === 'playing' || this.state === 'paused') {
      this.ball.draw(ctx);
    }

    if (this.state === 'ready') {
      const rightControls = RIGHT_PADDLE_AI ? 'Right: computer' : 'Right: ↑ / ↓';
      this.drawMessage('PONG', `Left: W / S    ${rightControls}`, 'Press Space to start   •   Esc / P to pause');
    } else if (this.state === 'paused') {
      this.drawMessage('Paused', 'Esc / P  resume', 'Q  quit to title');
    } else if (this.state === 'gameover') {
      this.drawMessage(`${this.winner} wins!`, 'Press Space to continue');
    }
  }

  drawCenterLine() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.moveTo(this.width / 2, 0);
    ctx.lineTo(this.width / 2, this.height);
    ctx.stroke();
    ctx.setLineDash([]); // reset so other strokes aren't dashed
  }

  drawScores() {
    const ctx = this.ctx;
    ctx.fillStyle = 'white';
    ctx.font = '48px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.leftScore, this.width / 4, 20);
    ctx.fillText(this.rightScore, (this.width * 3) / 4, 20);
  }

  // Dim the field and show a title plus up to two lines of text underneath.
  drawMessage(title, ...lines) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '48px monospace';
    ctx.fillText(title, this.width / 2, this.height / 2 - 40);

    ctx.font = '18px monospace';
    lines.forEach((line, i) => {
      ctx.fillText(line, this.width / 2, this.height / 2 + 20 + i * 30);
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game('pong');
  game.init();
  // Expose for debugging in the browser console (e.g. game.ball.vx = 600).
  window.game = game;
});
