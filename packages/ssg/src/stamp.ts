// The one attribute that says a page was generated.
//
// A file of its own because it is the whole contract between the two halves of this package: the
// document builder writes it and the client reads it, and they never import each other. Written in
// two places, they drift, and the failure is a page that mounts over its own markup.

/** The attribute a generated page carries on its `<body>`. */
export const STAMP = 'data-aweft-ssg';
