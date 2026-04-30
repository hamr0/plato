import { createAvatar } from '@dicebear/core';
import { botttsNeutral } from '@dicebear/collection';

export function avatarSvg(handle, size = 32) {
  return createAvatar(botttsNeutral, { seed: handle, size }).toString();
}
