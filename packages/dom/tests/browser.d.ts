// The browser globals this suite's `page.evaluate` callbacks name.
//
// The callbacks run in Chromium and the file around them runs in Node, so the compiler has to
// accept them without the DOM library. Narrow shapes, so a typo is still caught.

interface RouterPageElement {
	textContent: string | null;
	readonly offsetTop: number;
	click(): void;
}

declare const document: {
	getElementById(id: string): RouterPageElement | null;
};

declare const window: {
	scrollTo(x: number, y: number): void;
	readonly scrollY: number;
};

declare const history: { readonly scrollRestoration: string };

declare const location: { readonly hash: string };
