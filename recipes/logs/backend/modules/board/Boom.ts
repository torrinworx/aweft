// board/Boom: a public call that throws, so a page can produce a failed server call on demand.

export default () => ({
	public: true,
	call: () => { throw Object.assign(new Error('the module blew up'), { reason: 'boom' }); },
});
