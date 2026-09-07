// The names the components here ask for (design 142).
//
// A component names an icon and never draws one. What a name draws is the application's: a pack
// it puts in front of `Icons` answers first, which is how "our own left-chevron" works without a
// component knowing.

/**
 * The icon names the components in this package ask for, in the spelling the icon sets publish.
 *
 * An application whose `Icons` stack answers all of these has every component covered.
 * `@aweftjs/icons/<set>/+standard` is this list taken from one installed set.
 *
 * Example:
 *   const missing = standardIcons.filter((name) => myPack.icons[name] === undefined);
 */
export const standardIcons: readonly string[] = Object.freeze([
	'chevron-down',
	'chevron-up',
	'chevron-left',
	'chevron-right',
	'check',
	'x',
	'triangle-alert',
	'search',
	'upload',
]);
