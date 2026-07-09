/**
 * Renders a schema.org JSON-LD block. The `<` escape prevents a crafted string
 * from closing the script tag early (defense-in-depth; our data is static).
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  )
}
