// The static battery's configuration: the directory its 404 page is in. It is here to show the
// order rule: listed after `uploads`, it never sees `/files/<id>`.

export const config = {
	dir: process.env.AWEFT_SITE_DIR ?? 'dist',
};
