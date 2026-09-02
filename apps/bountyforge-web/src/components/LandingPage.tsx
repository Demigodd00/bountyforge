export default function LandingPage() {
  return <main>
    <nav className="nav shell">
      <a href="/" className="brand"><span className="brand-mark">BF</span><span>Bounty<span className="accent">Forge</span></span></a>
      <div className="nav-links"><a href="/bounties">Explore</a><a href="/post">Post</a><a href="/dashboard">Dashboard</a><a href="/admin">Protocol</a></div>
      <a className="button primary small nav-cta" href="/bounties">Launch app</a>
    </nav>

    <section className="hero shell">
      <div className="hero-copy">
        <p className="eyebrow"><span className="pulse" />GITHUB BOUNTIES ON GENLAYER</p>
        <h1>Ship code.<br /><em>Earn trust.</em></h1>
        <p className="lede">Fund public GitHub issues, verify fixes with GenLayer, and settle rewards onchain.</p>
        <div className="hero-actions"><a className="button primary" href="/bounties">Explore bounties <span>↘</span></a><a className="button ghost" href="/post">Post a bounty <span>＋</span></a></div>
        <div className="hero-trust"><span>Public evidence</span><span>·</span><span>Contract escrow</span><span>·</span><span>Appeals built in</span></div>
      </div>
      <div className="hero-card"><div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="hero-card-inner">
          <div className="card-top"><span>RELEASE 3.2</span><span className="live"><span className="pulse" />STUDIONET</span></div>
          <div className="signal"><div className="signal-ring">✦</div><div><strong>Work with proof.</strong><p>Issue. PR. Commit. Wallet.</p></div></div>
          <div className="mini-stats"><div><b>01</b><span>fund issue</span></div><div><b>02</b><span>verify fix</span></div><div><b>03</b><span>settle reward</span></div></div>
        </div>
      </div>
    </section>

    <section className="how shell"><div><p className="eyebrow">HOW IT WORKS</p><h2>Fund. Fix. Earn.</h2></div><div className="steps">
      <Step number="01" title="Fund a GitHub issue" text="Define objective acceptance criteria and lock a GEN reward in the contract." />
      <Step number="02" title="Submit verifiable work" text="Hunters link a public pull request, commit SHA, GitHub identity, and wallet marker." />
      <Step number="03" title="Let GenLayer decide" text="Validators review live repository evidence. Challenges and appeals protect both sides." />
    </div></section>

    <footer className="footer shell"><div className="brand"><span className="brand-mark">BF</span><span>Bounty<span className="accent">Forge</span></span></div><span>StudioNet release 3.2 · GitHub work. Onchain rewards.</span><a href="/admin">Protocol status ↗</a></footer>
  </main>;
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="step"><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></div>;
}
