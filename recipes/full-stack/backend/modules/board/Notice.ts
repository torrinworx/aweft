// board/Notice: `public: true`, so a page reaches it before anyone has signed in.

export default () => ({
	public: true,
	call: () => 'the board is open to everyone',
});
