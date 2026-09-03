// A module that holds a resource, so unloading it has something to let go of.
export default () => {
	let ticks = 0;
	const timer = setInterval(() => { ticks++; }, 1);
	const clock = {
		ticks: (): number => ticks,
		stopped: false,
		stop: (): void => { clearInterval(timer); clock.stopped = true; },
	};
	return clock;
};
