export default function Calcithune({ small = false }) {
  return (
    <span
      className={`calcithune ${small ? "calcithune-small" : ""}`}
      role="img"
      aria-label="Calcithune, monnaie virtuelle Calcito"
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="45" fill="#e8b552" />
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="#17130d"
          stroke="#ffe0a0"
          strokeWidth="1.5"
        />
        <circle
          cx="50"
          cy="50"
          r="31"
          fill="none"
          stroke="#b98c36"
          strokeDasharray="2 5"
        />
        <path
          d="M62 31a25 25 0 1 0 0 38M25 50h10l6-12 8 25 8-16h16"
          fill="none"
          stroke="#ffdc86"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path
          d="M20 18l4 7M80 18l-4 7M15 75l8-4M85 75l-8-4"
          stroke="#77511c"
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}
