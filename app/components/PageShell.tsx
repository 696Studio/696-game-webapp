export default function PageShell({
    title,
    subtitle,
    right,
    children,
  }: {
    title: string;
    subtitle?: string;
    right?: React.ReactNode;
    children: React.ReactNode;
  }) {
    return (
      <main className="min-h-screen flex flex-col items-center pt-10 px-4 pb-28">
        <div className="w-full max-w-4xl">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1 className="ui-title text-696">{title}</h1>
              {subtitle ? <div className="ui-subtitle mt-2">{subtitle}</div> : null}
            </div>
            {right ? right : null}
          </div>
  
          {children}
        </div>
      </main>
    );
  }
  