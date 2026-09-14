// A module for anyone holding `reports`. The administrator holds it through the table, and a
// person the administrator grants it to holds it from the next call on.

export default () => ({
	needs: 'reports',
	call: () => 'the monthly report',
});
