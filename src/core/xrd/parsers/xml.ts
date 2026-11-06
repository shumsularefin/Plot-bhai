/*
 * Small regular-expression XML helpers shared by the XML readers (XRDML, BRML, RASX). They are
 * used instead of DOMParser so the same code runs in a web worker, where DOMParser is not
 * available. They suit these flat, machine-written files; they do not handle nesting of an
 * element inside another of the same name.
 */

export const NS = '(?:[\\w.-]+:)?'; // optional namespace prefix

/** Every <tag …>…</tag> or <tag …/> element, with its attribute text and body. */
export function elements(xml: string, tag: string): { attrs: string; body: string }[] {
  const re = new RegExp(`<${NS}${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}${tag}>)`, 'g');
  return [...xml.matchAll(re)].map((m) => ({ attrs: m[1] ?? '', body: m[2] ?? '' }));
}

export function attribute(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];
}

export function firstText(xml: string, tag: string): string | undefined {
  return elements(xml, tag)[0]?.body.trim();
}
