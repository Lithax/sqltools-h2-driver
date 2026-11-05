import { ILanguageServerPlugin } from '@sqltools/types';
import H2Driver from './driver';
import { DRIVER_ALIASES } from '../constants';

const H2DriverPlugin: ILanguageServerPlugin = {
  register(server) {
    DRIVER_ALIASES.forEach(({ value }) => {
      server.getContext().drivers.set(value, H2Driver as any);
    });
  },
};

export default H2DriverPlugin;
