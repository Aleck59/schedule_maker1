import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Home, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Вершины пятиконечной звезды радиуса r с центром в начале координат */
function starPoints(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`);
  }
  return pts.join(' ');
}

/**
 * Анимация 404: студент читает под яблоней, яблоко падает ему на голову (над головой кружатся
 * звёздочки), отскакивает и встаёт на место нуля в «404», затем из него выглядывает червячок.
 * Конечное состояние задано в базовых стилях — при «уменьшении движения» показывается сразу оно.
 */
const STYLES = `
.nf-scene * { transform-box: view-box; }
.nf-apple { transform: translate(440px, 246px) scale(4.6); animation: nf-apple-path 2.6s both; }
.nf-apple-sway { transform-origin: 0px -8px; animation: nf-wobble 0.9s ease-in-out both; }
.nf-apple-shadow { opacity: 1; transform-origin: 440px 300px; animation: nf-shadow 2.6s both; }
.nf-head { transform-origin: 172px 228px; animation: nf-bonk 0.5s 1.3s ease-out both; }
.nf-eyes-read { opacity: 0; animation: nf-gone 0.01s 1.3s both; }
.nf-eyes-dizzy { opacity: 1; animation: nf-show 0.01s 1.3s both; }
.nf-stars { opacity: 1; animation: nf-show 0.25s 1.3s both; }
.nf-star { animation: nf-orbit 1.2s linear infinite; }
.nf-star:nth-child(2) { animation-delay: -0.4s; }
.nf-star:nth-child(3) { animation-delay: -0.8s; }
.nf-hole { opacity: 1; animation: nf-show 0.3s 2.6s both; }
.nf-worm-out { transform-origin: 0 0; animation: nf-worm-out 0.7s 2.8s cubic-bezier(.34,1.56,.64,1) both; }
.nf-worm-wiggle { transform-origin: 0 0; animation: nf-wiggle 1.8s 3.5s ease-in-out infinite; }
.nf-worm-blink { transform-origin: 27px -13px; animation: nf-blink 3.2s 4s infinite; }
.nf-crown { transform-origin: 135px 300px; animation: nf-tree 6s ease-in-out infinite; }
.nf-leaf { opacity: 0; animation: nf-leaf 7s 0.6s linear infinite; }
.nf-digit { animation: sm-fade-up 0.6s ease-out both; }
.nf-digit-2 { animation-delay: 0.15s; }

@keyframes nf-apple-path {
  0%, 34.6% { transform: translate(185px, 165px) scale(1); animation-timing-function: ease-in; }
  50% { transform: translate(180px, 190px) scale(1.08, 0.9); animation-timing-function: ease-out; }
  60% { transform: translate(245px, 128px) scale(1.6); }
  70% { transform: translate(310px, 106px) scale(2.3); animation-timing-function: ease-in; }
  80% { transform: translate(382px, 145px) scale(3.3); animation-timing-function: ease-in; }
  88% { transform: translate(440px, 250px) scale(4.9, 4.2); animation-timing-function: ease-out; }
  94% { transform: translate(440px, 243px) scale(4.4, 4.8); }
  100% { transform: translate(440px, 246px) scale(4.6); }
}
@keyframes nf-wobble {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(12deg); }
  50% { transform: rotate(-10deg); }
  75% { transform: rotate(6deg); }
}
@keyframes nf-shadow {
  0%, 80% { opacity: 0; transform: scale(0.3); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes nf-bonk {
  0% { transform: translateY(0) rotate(0deg); }
  30% { transform: translateY(4px) rotate(-6deg); }
  65% { transform: translateY(-1px) rotate(3deg); }
  100% { transform: translateY(0) rotate(0deg); }
}
@keyframes nf-show { from { opacity: 0; } to { opacity: 1; } }
@keyframes nf-gone { from { opacity: 1; } to { opacity: 0; } }
@keyframes nf-orbit {
  0% { transform: translate(24px, 0) scale(1); opacity: 1; }
  12.5% { transform: translate(17px, 5px) scale(1.1); opacity: 1; }
  25% { transform: translate(0, 7px) scale(1.15); opacity: 1; }
  37.5% { transform: translate(-17px, 5px) scale(1.1); opacity: 1; }
  50% { transform: translate(-24px, 0) scale(0.9); opacity: 0.85; }
  62.5% { transform: translate(-17px, -5px) scale(0.75); opacity: 0.55; }
  75% { transform: translate(0, -7px) scale(0.7); opacity: 0.5; }
  87.5% { transform: translate(17px, -5px) scale(0.8); opacity: 0.7; }
  100% { transform: translate(24px, 0) scale(1); opacity: 1; }
}
@keyframes nf-worm-out {
  from { transform: translate(-4px, 5px) scale(0.05); }
  to { transform: translate(0, 0) scale(1); }
}
@keyframes nf-wiggle {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-9deg); }
  50% { transform: rotate(4deg); }
  75% { transform: rotate(-4deg); }
}
@keyframes nf-blink {
  0%, 92%, 100% { transform: scaleY(1); }
  95% { transform: scaleY(0.1); }
}
@keyframes nf-tree {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(1.2deg); }
}
@keyframes nf-leaf {
  0% { opacity: 0; transform: translate(95px, 150px) rotate(0deg); }
  8% { opacity: 1; }
  30% { transform: translate(78px, 200px) rotate(70deg); }
  55% { transform: translate(102px, 245px) rotate(-30deg); }
  80% { opacity: 1; transform: translate(84px, 292px) rotate(50deg); }
  100% { opacity: 0; transform: translate(90px, 296px) rotate(80deg); }
}
@media (prefers-reduced-motion: reduce) {
  .nf-scene *, .nf-digit { animation: none !important; }
}
`;

function Apple() {
  return (
    <g className="nf-apple-sway">
      <path d="M0,-7 C5,-11 12,-8 11,0 C10,8 5,11 0,9.5 C-5,11 -10,8 -11,0 C-12,-8 -5,-11 0,-7 Z" fill="#e5484d" />
      <path d="M-6,-5 C-8,-3 -8.5,0 -8,2" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M0,-7 Q0.5,-11 2.5,-13" stroke="#7c4a1e" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M1.5,-11 C4,-15 9,-14 9.5,-12 C7,-9.5 3,-9.5 1.5,-11 Z" fill="#4caf50" />
    </g>
  );
}

function Scene() {
  return (
    <svg viewBox="0 0 640 340" className="nf-scene h-auto w-full" role="img" aria-label="404: яблоко упало студенту на голову и стало нулём">
      <style>{STYLES}</style>
      {/* Земля */}
      <path d="M20,300 Q320,292 620,300" stroke="var(--border)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse className="nf-apple-shadow" cx="440" cy="300" rx="38" ry="5" fill="var(--foreground)" fillOpacity="0.08" />

      {/* Яблоня */}
      <path d="M116,301 Q128,292 128,270 L130,150 L142,150 L144,270 Q144,292 156,301 Z" fill="#8b5a2b" />
      <path d="M132,205 Q115,190 104,178 M140,190 Q160,176 170,168" stroke="#8b5a2b" strokeWidth="6" fill="none" strokeLinecap="round" />
      <g className="nf-crown">
        <circle cx="86" cy="128" r="46" fill="#3f9d4a" />
        <circle cx="190" cy="128" r="48" fill="#3f9d4a" />
        <circle cx="136" cy="98" r="62" fill="#4cb35a" />
        <circle cx="140" cy="152" r="38" fill="#43a650" />
        <circle cx="105" cy="80" r="22" fill="#5cc46a" opacity="0.7" />
        <circle cx="100" cy="100" r="6" fill="#e5484d" />
        <circle cx="168" cy="78" r="6" fill="#e5484d" />
        <circle cx="62" cy="140" r="6" fill="#e5484d" />
        <circle cx="214" cy="112" r="6" fill="#e5484d" />
      </g>
      <path className="nf-leaf" d="M0,0 C4,-5 10,-4 11,0 C7,4 3,4 0,0 Z" fill="#5cc46a" />

      {/* Студент с книгой, сидит у ствола */}
      <path d="M168,282 L238,284 Q247,285 247,292 L247,299 L168,299 Z" fill="#334155" />
      <ellipse cx="252" cy="294" rx="8" ry="6" fill="#1f2937" />
      <path d="M156,296 L156,250 Q156,233 172,233 Q188,233 188,250 L188,296 Z" fill="var(--primary)" />
      <path d="M196,256 L214,262 L214,281 L196,275 Z" fill="#fff" stroke="#94a3b8" strokeWidth="1.2" />
      <path d="M214,262 L232,256 L232,275 L214,281 Z" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.2" />
      <path d="M200,262 L210,265 M200,267 L210,270 M218,265 L228,262 M218,270 L228,267" stroke="#cbd5e1" strokeWidth="1" />
      <path d="M182,246 Q190,272 205,270" stroke="var(--primary)" strokeWidth="8" fill="none" strokeLinecap="round" />
      <circle cx="207" cy="269" r="4.5" fill="#f2c9a0" />
      <g className="nf-head">
        <rect x="167" y="222" width="10" height="12" rx="3" fill="#e8b98c" />
        <circle cx="172" cy="214" r="15" fill="#f2c9a0" />
        <path d="M157,213 Q157,197 172,197 Q188,197 187,213 Q181,204 172,206 Q163,204 157,213 Z" fill="#3b2f2f" />
        <g className="nf-eyes-read" fill="#3b2f2f">
          <ellipse cx="174" cy="216" rx="1.6" ry="1.2" />
          <ellipse cx="182" cy="216" rx="1.6" ry="1.2" />
        </g>
        <g className="nf-eyes-dizzy" stroke="#3b2f2f" strokeWidth="1.4" fill="none" strokeLinecap="round">
          <path d="M171,213 l4,4 m0,-4 l-4,4" />
          <path d="M179,213 l4,4 m0,-4 l-4,4" />
        </g>
        <path d="M175,222 Q178,224.5 181,222" stroke="#b4776b" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </g>
      <g transform="translate(176,190)">
        <g className="nf-stars" fill="#fbbf24" stroke="#f59e0b" strokeWidth="0.8">
          <polygon className="nf-star" points={starPoints(5.5)} />
          <polygon className="nf-star" points={starPoints(4.5)} />
          <polygon className="nf-star" points={starPoints(5)} />
        </g>
      </g>

      {/* 4 [яблоко] 4 */}
      <text className="nf-digit" x="335" y="300" textAnchor="middle" fontSize="150" fontWeight="700" fill="var(--primary)">
        4
      </text>
      <text className="nf-digit nf-digit-2" x="545" y="300" textAnchor="middle" fontSize="150" fontWeight="700" fill="var(--primary)">
        4
      </text>
      <g className="nf-apple">
        <Apple />
      </g>
      <ellipse className="nf-hole" cx="468" cy="238" rx="5.5" ry="4.5" fill="#6b1d1d" />

      {/* Червячок в шапочке выпускника */}
      <g transform="translate(468,238)">
        <g className="nf-worm-out">
          <g className="nf-worm-wiggle">
            <path d="M0,0 C2,-7 8,-11 14,-11 C19,-11 22,-13 25,-14" stroke="#65a30d" strokeWidth="9" fill="none" strokeLinecap="round" />
            <path d="M0,0 C2,-7 8,-11 14,-11 C19,-11 22,-13 25,-14" stroke="#a3e635" strokeWidth="6" fill="none" strokeLinecap="round" />
            <circle cx="27" cy="-14" r="6.5" fill="#a3e635" stroke="#65a30d" strokeWidth="1.2" />
            <g className="nf-worm-blink">
              <circle cx="28.5" cy="-15.5" r="2.2" fill="#fff" />
              <circle cx="29.2" cy="-15.3" r="1.1" fill="#1f2937" />
            </g>
            <path d="M26,-10.5 Q28.5,-9 31,-10.8" stroke="#3f6212" strokeWidth="1" fill="none" strokeLinecap="round" />
            <path d="M18,-21 L27,-25 L36,-21 L27,-17 Z" fill="#1f2937" />
            <path d="M23,-19.5 L23,-17 Q27,-15 31,-17 L31,-19.5" fill="#1f2937" />
            <path d="M36,-21 L37,-15" stroke="#fbbf24" strokeWidth="1.2" strokeLinecap="round" />
          </g>
        </g>
      </g>
    </svg>
  );
}

export default function NotFoundPage() {
  const [run, setRun] = useState(0);
  return (
    <div className="mx-auto mt-6 flex max-w-2xl flex-col items-center gap-3 px-2 text-center">
      <Scene key={run} />
      <h1 className="text-2xl font-semibold">Страница не найдена</h1>
      <p className="max-w-md text-muted-foreground">
        Такого адреса нет: возможно, ссылка устарела или в ней опечатка. Зато яблоко упало удачно.
      </p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to="/">
            <Home /> На главную
          </Link>
        </Button>
        <Button variant="outline" onClick={() => setRun((n) => n + 1)}>
          <RotateCcw /> Ещё раз
        </Button>
      </div>
    </div>
  );
}
