# Third-party notices

This package includes or is built from the third-party material below. Each item keeps its own licence; none of it is covered by this package's Apache-2.0 licence.

## Lucide icons

- What: the icon path data in `src/icons/data.ts` (a subset of Lucide, lowered to one SVG path string per icon).
- Source: `lucide-react` version 0.511.0.
- Licence: ISC. Portions are derived from Feather, which is MIT-licensed (notice below).
- The ISC notice also ships beside the data in `src/icons/LICENSE`.

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### Feather (MIT)

```text
The MIT License (MIT)

Copyright (c) 2013-2022 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled font families

`src/fonts/registry.ts` lists twelve font families that a host application can serve and register. All twelve are licensed under the SIL Open Font License, Version 1.1 (OFL-1.1, <https://openfontlicense.org>):

| Family | Category |
| --- | --- |
| Inter | sans |
| Montserrat | sans |
| Poppins | sans |
| Space Grotesk | sans |
| Playfair Display | serif |
| DM Serif Display | serif |
| Bebas Neue | display |
| Anton | display |
| Oswald | display |
| Archivo Black | display |
| Roboto Mono | mono |
| Caveat | handwriting |

The font binaries are not part of this package yet. When they are added, each family's own copyright notice and licence text (OFL-1.1) must ship in the same folder as its files, as the OFL requires. The OFL does not permit selling the fonts on their own; embedding them in documents and exports is permitted.
