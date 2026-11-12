import type { ReactNode } from 'react';

interface PlaceholderPageProps {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}

/** Contenedor común de las páginas provisionales mientras llegan las historias de cada panel. */
export function PlaceholderPage({ eyebrow, title, description, children }: PlaceholderPageProps) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">{eyebrow}</p>
      <h1 className="text-3xl font-bold text-stone-900 sm:text-4xl">{title}</h1>
      <p className="text-lg text-stone-600">{description}</p>
      {children}
    </main>
  );
}
