// Project 3 — DEX Frontend (React)
// frontend/src/App.jsx
import { useState, useEffect } from "react";

const DARK = "#0b0e11";
const CARD = "#131722";
const BORDER = "#1e2433";
const TEAL = "#00d4aa";
const BLUE = "#3b82f6";

const PAIRS = [{ from: "ETH", to: "UDAY" }, { from: "UDAY", to: "ETH" }];
const MOCK_PRICE = 1850; // 1 ETH = 1850 UDAY
const FEE = 0.003;

function Tab({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "10px 0", border: "none", background: active ? CARD : "transparent",
      color: active ? "#fff" : "#555", fontWeight: 700, cursor: "pointer", fontSize: 14,
      borderRadius: active ? 10 : 0, transition: "all 0.2s"
    }}>{label}</button>
  );
}

function TokenInput({ label, token, value, onChange, balance, onMax }) {
  return (
    <div style={{ background: "#0b0e11", borderRadius: 12, padding: "14px 16px", marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ color: "#555", fontSize: 12 }}>{label}</span>
        <span style={{ color: "#555", fontSize: 12 }}>Balance: <span style={{ color: "#fff" }}>{balance}</span>
          {onMax && <button onClick={onMax} style={{ background: "transparent", border: "none", color: TEAL, cursor: "pointer", fontSize: 12, marginLeft: 6 }}>MAX</button>}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <input value={value} onChange={e => onChange(e.target.value)} placeholder="0.0"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 24, fontFamily: "monospace", fontWeight: 700 }} />
        <div style={{ background: "#1e2433", borderRadius: 99, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 18 }}>{token === "ETH" ? "⬡" : "🪙"}</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{token}</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("swap");
  const [fromVal, setFromVal] = useState("");
  const [toVal, setToVal] = useState("");
  const [pair, setPair] = useState(0);
  const [slippage, setSlippage] = useState("0.5");
  const [txStatus, setTxStatus] = useState(null);
  const [lpAmount, setLpAmount] = useState("");

  const currentPair = PAIRS[pair];
  const rate = pair === 0 ? MOCK_PRICE : (1 / MOCK_PRICE);

  useEffect(() => {
    if (fromVal && !isNaN(fromVal)) {
      const out = parseFloat(fromVal) * rate * (1 - FEE);
      setToVal(out.toFixed(4));
    } else {
      setToVal("");
    }
  }, [fromVal, pair]);

  function simulate() {
    setTxStatus("pending");
    setTimeout(() => setTxStatus("success"), 2000);
    setTimeout(() => setTxStatus(null), 5000);
  }

  const priceImpact = fromVal ? Math.min((parseFloat(fromVal) / 1000) * 100, 5).toFixed(2) : "0.00";

  return (
    <div style={{ minHeight: "100vh", background: DARK, color: "#e2e8f0", fontFamily: "'Inter', sans-serif" }}>
      {/* Nav */}
      <div style={{ borderBottom: `1px solid ${BORDER}`, padding: "14px 40px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <span style={{ fontWeight: 900, fontSize: 18, color: TEAL }}>UDAY DEX</span>
          {["Swap", "Liquidity", "Analytics"].map(t => (
            <button key={t} onClick={() => setTab(t.toLowerCase())} style={{
              background: "transparent", border: "none", color: tab === t.toLowerCase() ? "#fff" : "#555",
              cursor: "pointer", fontSize: 14, fontWeight: 600, borderBottom: tab === t.toLowerCase() ? `2px solid ${TEAL}` : "none", paddingBottom: 2
            }}>{t}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ background: "#1e2433", borderRadius: 99, padding: "6px 14px", fontSize: 12, color: "#888" }}>BSC Testnet</div>
          <div style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}44`, borderRadius: 99, padding: "8px 16px", fontSize: 13, color: TEAL }}>0xAbC1...9f3E</div>
        </div>
      </div>

      {tab === "swap" && (
        <div style={{ maxWidth: 460, margin: "60px auto", padding: "0 16px" }}>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Swap</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#555", fontSize: 12 }}>Slippage:</span>
                {["0.1", "0.5", "1.0"].map(s => (
                  <button key={s} onClick={() => setSlippage(s)} style={{
                    padding: "4px 10px", borderRadius: 6, border: `1px solid ${slippage === s ? TEAL : BORDER}`,
                    background: slippage === s ? `${TEAL}22` : "transparent", color: slippage === s ? TEAL : "#555", cursor: "pointer", fontSize: 12
                  }}>{s}%</button>
                ))}
              </div>
            </div>

            <TokenInput label="From" token={currentPair.from} value={fromVal} onChange={setFromVal}
              balance={currentPair.from === "ETH" ? "2.4500" : "4,200.00"} onMax={() => setFromVal(currentPair.from === "ETH" ? "2.45" : "4200")} />

            {/* Flip button */}
            <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
              <button onClick={() => { setPair(p => 1 - p); setFromVal(""); setToVal(""); }} style={{
                width: 40, height: 40, borderRadius: 10, background: "#1e2433", border: `1px solid ${BORDER}`,
                color: "#fff", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center"
              }}>⇅</button>
            </div>

            <TokenInput label="To (estimated)" token={currentPair.to} value={toVal} onChange={() => {}} balance={currentPair.to === "ETH" ? "2.4500" : "4,200.00"} />

            {fromVal && (
              <div style={{ background: "#0b0e11", borderRadius: 10, padding: "12px 16px", marginTop: 12, fontSize: 13 }}>
                {[
                  ["Rate", `1 ${currentPair.from} = ${rate.toFixed(4)} ${currentPair.to}`],
                  ["Fee (0.3%)", `${fromVal ? (parseFloat(fromVal) * 0.003).toFixed(6) : "—"} ${currentPair.from}`],
                  ["Price Impact", `${priceImpact}%`],
                  ["Min Received", `${toVal ? (parseFloat(toVal) * (1 - parseFloat(slippage) / 100)).toFixed(4) : "—"} ${currentPair.to}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", color: "#888" }}>
                    <span>{k}</span><span style={{ color: parseFloat(priceImpact) > 3 ? "#f87171" : "#fff" }}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={simulate} style={{
              width: "100%", marginTop: 16, padding: 16, background: fromVal ? `linear-gradient(135deg, ${TEAL}, ${BLUE})` : "#1e2433",
              border: "none", borderRadius: 14, color: fromVal ? "#000" : "#555", fontWeight: 800, fontSize: 16, cursor: fromVal ? "pointer" : "default", transition: "all 0.2s"
            }}>{fromVal ? "Swap" : "Enter an amount"}</button>

            {txStatus === "pending" && <div style={{ marginTop: 12, color: BLUE, fontSize: 13, textAlign: "center" }}>⏳ Swapping on BSC testnet...</div>}
            {txStatus === "success" && <div style={{ marginTop: 12, color: TEAL, fontSize: 13, textAlign: "center" }}>✓ Swap confirmed! View on BscScan →</div>}
          </div>
        </div>
      )}

      {tab === "liquidity" && (
        <div style={{ maxWidth: 460, margin: "60px auto", padding: "0 16px" }}>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Add Liquidity</div>
            <div style={{ background: `${TEAL}11`, border: `1px solid ${TEAL}33`, borderRadius: 12, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#888" }}>
              💡 You will receive LP tokens representing your share of the ETH/UDAY pool.
            </div>
            <TokenInput label="ETH Amount" token="ETH" value={fromVal} onChange={v => { setFromVal(v); setToVal(v ? (parseFloat(v) * MOCK_PRICE).toFixed(2) : ""); }} balance="2.4500" />
            <div style={{ textAlign: "center", color: "#555", margin: "8px 0" }}>+</div>
            <TokenInput label="UDAY Amount" token="UDAY" value={toVal} onChange={() => {}} balance="4,200.00" />
            <div style={{ background: "#0b0e11", borderRadius: 10, padding: "12px 16px", marginTop: 16, fontSize: 13 }}>
              {[
                ["Pool Share", fromVal ? `${Math.min(parseFloat(fromVal) * 10, 100).toFixed(2)}%` : "—"],
                ["LP Tokens to Receive", fromVal ? (parseFloat(fromVal) * 100).toFixed(4) : "—"],
                ["Current Pool Rate", `1 ETH = ${MOCK_PRICE} UDAY`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", color: "#888" }}>
                  <span>{k}</span><span style={{ color: "#fff" }}>{v}</span>
                </div>
              ))}
            </div>
            <button onClick={simulate} style={{
              width: "100%", marginTop: 16, padding: 16, background: `linear-gradient(135deg, ${TEAL}, ${BLUE})`,
              border: "none", borderRadius: 14, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer"
            }}>Add Liquidity</button>
            {txStatus === "success" && <div style={{ marginTop: 12, color: TEAL, fontSize: 13, textAlign: "center" }}>✓ Liquidity added! You received LP tokens.</div>}
          </div>
        </div>
      )}

      {tab === "analytics" && (
        <div style={{ maxWidth: 900, margin: "40px auto", padding: "0 24px" }}>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 24 }}>Pool Analytics</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
            {[["Total Liquidity", "$2.4M"], ["24h Volume", "$184K"], ["24h Fees", "$552"], ["APY", "12.4%"]].map(([k, v]) => (
              <div key={k} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "20px 20px" }}>
                <div style={{ color: "#555", fontSize: 12, marginBottom: 6 }}>{k}</div>
                <div style={{ color: k === "APY" ? TEAL : "#fff", fontSize: 22, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
          {/* Simulated price chart */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 24 }}>
            <div style={{ fontWeight: 600, marginBottom: 16 }}>ETH/UDAY Price (7d)</div>
            <svg viewBox="0 0 800 160" width="100%" style={{ overflow: "visible" }}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TEAL} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Simulated smooth price path */}
              <path d="M0,100 C50,95 100,110 150,90 C200,70 250,85 300,75 C350,65 400,80 450,60 C500,45 550,55 600,40 C650,30 700,45 750,35 L800,30 L800,160 L0,160 Z"
                fill="url(#g)" />
              <path d="M0,100 C50,95 100,110 150,90 C200,70 250,85 300,75 C350,65 400,80 450,60 C500,45 550,55 600,40 C650,30 700,45 750,35 L800,30"
                fill="none" stroke={TEAL} strokeWidth="2" />
              {[0, 200, 400, 600, 800].map((x, i) => (
                <text key={x} x={x} y={155} fill="#555" fontSize="11" textAnchor="middle">
                  {["Mon", "Tue", "Wed", "Thu", "Fri"][i]}
                </text>
              ))}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
