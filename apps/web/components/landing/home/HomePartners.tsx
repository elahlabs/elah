import { ArrowUpRight } from 'lucide-react'
import { container, display, label } from '@/components/eb'

/** Brand marks from simple-icons (CC0), drawn in each partner's brand colour. */
const CLAUDE_PATH =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
const CLOUDFLARE_PATH =
  'M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727'

const programs = [
  { name: 'Claude', program: 'for Startups', href: 'https://claude.com/programs/startups', path: CLAUDE_PATH, color: '#D97757' },
  { name: 'Cloudflare', program: 'for Startups', href: 'https://www.cloudflare.com/startups/', path: CLOUDFLARE_PATH, color: '#F38020' },
]

/**
 * Startup programs elah has been accepted into: brand mark + condensed name in
 * hairline cells, same rhythm as the old stats row. Each cell links to the
 * program's own page. Worded as acceptance, not partnership.
 */
export function HomePartners() {
  return (
    <section data-scene="Programs" className="py-16 lg:py-[88px]" aria-labelledby="programs-heading">
      <div className={container}>
        <p id="programs-heading" className={`m-0 mb-4 flex items-center gap-2 text-[var(--lp-ink)] ${label}`}>
          <span aria-hidden className="h-[7px] w-[7px] bg-[#FF003C]" />
          Recently accepted into
        </p>
        <ul className="m-0 grid list-none grid-cols-1 border-y border-[var(--lp-line)] p-0 sm:grid-cols-2">
          {programs.map((p, i) => (
            <li key={p.name} className={i > 0 ? 'border-t border-[var(--lp-line)] sm:border-l sm:border-t-0' : ''}>
              <a
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full flex-col gap-4 px-1 py-6 no-underline transition-colors hover:bg-[var(--lp-paper2)] sm:px-5"
              >
                <span className={`flex items-center justify-between text-[var(--lp-muted)] ${label}`}>
                  {String(i + 1).padStart(2, '0')} · Startup program
                  <ArrowUpRight size={14} strokeWidth={2} aria-hidden className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
                <span className="flex items-center gap-4">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-9 w-9 shrink-0 sm:h-11 sm:w-11" fill={p.color}>
                    <path d={p.path} />
                  </svg>
                  <span className={`flex flex-col leading-none ${display}`}>
                    <span className="text-[40px] font-extrabold text-[var(--lp-ink)] sm:text-[52px]">{p.name}</span>
                    <span className="mt-1 text-[20px] font-extrabold text-[var(--lp-muted)] sm:text-[24px]">{p.program}</span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
