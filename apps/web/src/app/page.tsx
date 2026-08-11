const foundations = [
  ["Git history", "Commits and source evolution"],
  ["GitHub activity", "Issues, pull requests, reviews, and comments"],
  ["Repository memory", "Durable, source-neutral historical context"],
  ["Retrieval", "Relevant context for downstream coding tools"],
] as const;

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">SWEGA / FOUNDATION</p>
        <h1>Repository history, shaped into useful memory.</h1>
        <p className="lede">
          SWEGA is a repository-agnostic intelligence layer designed to give AI
          coding agents the historical context behind a codebase.
        </p>
      </section>

      <section className="foundations" aria-labelledby="foundation-heading">
        <div className="section-heading">
          <h2 id="foundation-heading">Initial boundaries</h2>
          <span>Architecture ready</span>
        </div>
        <div className="grid">
          {foundations.map(([title, description], index) => (
            <article key={title}>
              <p className="index">0{index + 1}</p>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
