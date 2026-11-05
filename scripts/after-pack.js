const path = require('path');
const { rcedit } = require('rcedit');

exports.default = async function(context) {
  if (context.electronPlatformName === 'win32') {
    const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
    const iconPath = path.resolve('resources/icons/icon.ico');
    try {
      await rcedit(exePath, {
        icon: iconPath,
        'version-string': {
          ProductName: 'LushCake',
          FileDescription: 'LushCake Desktop Application',
          CompanyName: 'LushCake',
          LegalCopyright: 'Copyright © LushCake'
        }
      });
      console.log('[after-pack] Successfully injected icon into', exePath);
    } catch (e) {
      console.warn('[after-pack] Icon injection warning:', e.message);
    }
  }
};
