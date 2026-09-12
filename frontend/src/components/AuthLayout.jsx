import personYellow from "../assets/illo/person-yellow.png";
import personGreen from "../assets/illo/person-green.png";
import personPurple from "../assets/illo/person-purple.png";
import bubbleGreen from "../assets/illo/bubble-green.png";
import bubbleSmiley from "../assets/illo/bubble-smiley.png";
import bubbleHeart from "../assets/illo/bubble-heart.png";
import bubbleCheck from "../assets/illo/bubble-check.png";
import bubbleYellow from "../assets/illo/bubble-yellow.png";
import arcGreen from "../assets/illo/arc-green.png";
import arcBlue from "../assets/illo/arc-blue.png";

/**
 * Split-screen shell for the auth pages: form on the left, illustrated panel
 * on the right. The panel is decorative, so it carries aria-hidden and
 * collapses entirely below the tablet breakpoint.
 */

// The artwork is sliced into separate sprites so each figure and bubble can
// bob on its own timing. Positions are percentages of the original 512x768
// canvas, taken from each piece's bounding box.
const PIECES = [
  { src: personYellow, left: 3.125, top: 10.286, width: 39.062, height: 31.771, dur: 7.5, delay: 0, halo: "rgba(186, 180, 240, 0.30)" },
  { src: personGreen, left: 67.383, top: 32.031, width: 32.617, height: 33.073, dur: 8.5, delay: -2.6, halo: "rgba(150, 220, 175, 0.26)" },
  { src: personPurple, left: 7.031, top: 56.51, width: 55.469, height: 38.802, dur: 9.2, delay: -5.1, halo: "rgba(150, 185, 240, 0.26)" },

  { src: bubbleGreen, left: 50.586, top: 17.708, width: 23.828, height: 9.766, dur: 5.4, delay: -0.8 },
  { src: bubbleSmiley, left: 41.602, top: 29.036, width: 18.555, height: 10.156, dur: 6.1, delay: -2.2 },
  { src: bubbleHeart, left: 43.945, top: 40.885, width: 19.336, height: 10.286, dur: 5.8, delay: -3.4 },
  { src: bubbleCheck, left: 36.328, top: 53.125, width: 19.336, height: 9.766, dur: 6.6, delay: -1.5 },
  { src: bubbleYellow, left: 52.148, top: 64.583, width: 23.242, height: 10.417, dur: 5.9, delay: -4.2 },

  { src: arcGreen, left: 61.523, top: 26.562, width: 10.742, height: 13.932, dur: 7.8, delay: -3.9 },
  { src: arcBlue, left: 33.789, top: 45.573, width: 8.594, height: 9.505, dur: 7.1, delay: -1.9 },
];

// Four-point sparkle. The position lives on the transform attribute, so the
// twinkle animation may only touch fill — a CSS transform would override this
// and stack every star at the origin.
const Star = ({ x, y, size = 1, className = "star" }) => (
  <path
    className={className}
    transform={`translate(${x} ${y}) scale(${size})`}
    d="M 0 -5 Q 0.7 -0.7 5 0 Q 0.7 0.7 0 5 Q -0.7 0.7 -5 0 Q -0.7 -0.7 0 -5 Z"
  />
);

// Ambient layer behind the artwork. Stars drift in loose clusters,
// each group on its own timing.
const Constellation = () => (
  <svg
    className="auth-stars"
    viewBox="0 0 420 640"
    preserveAspectRatio="xMidYMid slice"
    role="presentation"
  >
    <g className="node-group group-a">
      <Star x={70} y={120} size={0.62} />
      <Star x={190} y={80} size={0.8} className="star star-lit" />
      <Star x={250} y={190} size={0.52} className="star star-soft" />
    </g>

    <g className="node-group group-b">
      <Star x={120} y={330} size={0.74} className="star star-lit" />
      <Star x={300} y={290} size={0.54} />
      <Star x={60} y={430} size={0.6} className="star star-soft" />
    </g>

    <g className="node-group group-c">
      <Star x={230} y={500} size={0.66} />
      <Star x={340} y={560} size={0.48} className="star star-soft" />
      <Star x={150} y={560} size={0.7} className="star star-lit" />
    </g>

    <g className="node-group group-d">
      <Star x={350} y={120} size={0.42} className="star star-soft" />
      <Star x={40} y={240} size={0.38} className="star star-soft" />
      <Star x={330} y={410} size={0.44} className="star star-soft" />
    </g>
  </svg>
);

/**
 * Message routes, each with a dot travelling along it. Shares the 512x768
 * coordinate space of the sprites, so the paths start and end near the right
 * phones. Rendered beneath the sprite layer so messages pass behind the
 * bubbles and figures.
 */
const MessageRoutes = () => (
  <svg
    className="illo-routes"
    viewBox="0 0 512 768"
    preserveAspectRatio="none"
    role="presentation"
  >
    <path
      id="route-a"
      className="route"
      d="M 196 168 C 268 196, 330 268, 372 366"
    />
    <path
      id="route-b"
      className="route"
      d="M 366 424 C 320 512, 268 548, 214 556"
    />

    <circle className="msg-dot msg-dot-a" r="5" />
    <circle className="msg-dot msg-dot-b" r="4.5" />
  </svg>
);

const AuthLayout = ({ children }) => (
  <div className="auth-shell">
    <section className="auth-form-side">
      <div className="auth-form-inner">{children}</div>
    </section>

    <aside className="auth-panel-side">
      <div className="auth-visual" aria-hidden="true">
        <Constellation />

        {/* Background images rather than <img>: browsers skip fetching them
            while the panel is display:none, so mobile never pays for them. */}
        <div className="auth-illo">
          {PIECES.filter((piece) => piece.halo).map((piece) => (
            <span
              key={`halo-${piece.src}`}
              className="illo-halo"
              style={{
                left: `${piece.left}%`,
                top: `${piece.top}%`,
                width: `${piece.width}%`,
                height: `${piece.height}%`,
                background: `radial-gradient(circle at 50% 50%, ${piece.halo} 0%, ${piece.halo.replace(/[\d.]+\)$/, "0)")} 68%)`,
                animationDuration: `${piece.dur}s`,
                animationDelay: `${piece.delay}s`,
              }}
            />
          ))}

          {/* Routes sit between the halos and the sprites, so a message
              travels behind the bubbles and figures rather than over them. */}
          <MessageRoutes />

          {PIECES.map((piece) => (
            <span
              key={piece.src}
              className="illo-piece"
              style={{
                left: `${piece.left}%`,
                top: `${piece.top}%`,
                width: `${piece.width}%`,
                height: `${piece.height}%`,
                backgroundImage: `url(${piece.src})`,
                animationDuration: `${piece.dur}s`,
                animationDelay: `${piece.delay}s`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="auth-panel-copy">
        <span className="auth-wordmark">SwiftChat</span>
        <p>Conversations that keep up with you.</p>
      </div>
    </aside>
  </div>
);

export default AuthLayout;
