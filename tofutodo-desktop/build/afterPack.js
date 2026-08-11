const path = require('path');
const rcedit = require('rcedit');

module.exports = async (context) => {
    if (context.electronPlatformName !== 'win32') return;

    const appInfo = context.packager.appInfo;
    const executablePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
    await rcedit(executablePath, {
        icon: path.join(__dirname, 'icon.ico'),
        'file-version': appInfo.version,
        'product-version': appInfo.version,
        'version-string': {
            CompanyName: 'dogEleven',
            FileDescription: 'TofuTodo Desktop Widget',
            ProductName: 'TofuTodo Widget',
            InternalName: 'TofuTodo-Widget',
            OriginalFilename: 'TofuTodo-Widget.exe'
        }
    });
};
