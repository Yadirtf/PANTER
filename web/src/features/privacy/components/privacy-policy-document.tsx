import { PRIVACY_POLICY } from '@panter/contracts';

/** Fecha ISO (AAAA-MM-DD) en español, sin depender del ICU del servidor ni del navegador. */
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export function formatPolicyDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} de ${MONTHS[month! - 1]} de ${year}`;
}

/**
 * Texto del aviso de privacidad (HU-109), el mismo de la app: viene de PRIVACY_POLICY en
 * @panter/contracts. Lo usan la página pública /privacidad y /consentimiento.
 */
export function PrivacyPolicyDocument({ headingLevel = 1 }: { headingLevel?: 1 | 2 }) {
  const Title = headingLevel === 1 ? 'h1' : 'h2';
  const Section = headingLevel === 1 ? 'h2' : 'h3';
  return (
    <article className="flex flex-col gap-6 text-stone-700">
      <header className="flex flex-col gap-2">
        <Title className="text-3xl font-bold text-stone-900">{PRIVACY_POLICY.title}</Title>
        <p className="text-sm text-stone-500">
          {`Versión ${PRIVACY_POLICY.version} · Vigente desde el ${formatPolicyDate(PRIVACY_POLICY.effectiveFrom)}`}
        </p>
      </header>
      {PRIVACY_POLICY.draft ? (
        <p
          role="note"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 font-medium text-amber-900"
        >
          Borrador: este aviso está en revisión legal y puede cambiar antes del lanzamiento público
          de PANTER.
        </p>
      ) : null}
      {PRIVACY_POLICY.sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <Section className="text-xl font-semibold text-stone-900">{section.title}</Section>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
