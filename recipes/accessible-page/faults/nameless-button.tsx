// A button that is an icon and nothing else. The build cannot see the fault, because the name
// would have come from the `Icon` inside it; the mount can, and throws with the fix.

import { Button, Icon, h, mount } from '@aweftjs/ui';

const page = globalThis as unknown as { document: { body: unknown } };

mount(page.document.body as never, <Button size="icon" icon={<Icon name="lucide:x" />} />);
