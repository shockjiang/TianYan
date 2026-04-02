import { registerTuple } from './registry';
import { nameSuffixMatcher, siblingDirMatcher, sameNameMatcher, combinedMatcher } from './matchers';
import { RgbMaskViewer } from './RgbMask';
import { RgbDepthViewer } from './RgbDepth';
import { RgbMaskDepthViewer } from './RgbMaskDepth';
import { RgbJsonViewer } from './RgbJson';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.webp'];

// RGB + Mask
registerTuple({
  name: 'RGB + Mask',
  key: 'rgb_mask',
  roles: ['rgb', 'mask'],
  matcher: combinedMatcher(
    nameSuffixMatcher(['rgb', 'mask'], {
      rgb: { suffixes: [''], extensions: IMAGE_EXTS },
      mask: { suffixes: ['_mask'], extensions: IMAGE_EXTS },
    }),
    siblingDirMatcher(['rgb', 'mask'], {
      rgb: ['rgb', 'color', 'image', 'images'],
      mask: ['mask', 'masks', 'seg', 'segmentation'],
    })
  ),
  component: RgbMaskViewer,
});

// RGB + Depth
registerTuple({
  name: 'RGB + Depth',
  key: 'rgb_depth',
  roles: ['rgb', 'depth'],
  matcher: combinedMatcher(
    nameSuffixMatcher(['rgb', 'depth'], {
      rgb: { suffixes: [''], extensions: IMAGE_EXTS },
      depth: { suffixes: ['_depth'], extensions: IMAGE_EXTS },
    }),
    siblingDirMatcher(['rgb', 'depth'], {
      rgb: ['rgb', 'color', 'image', 'images'],
      depth: ['depth', 'depths', 'depth_map'],
    })
  ),
  component: RgbDepthViewer,
});

// RGB + Mask + Depth
registerTuple({
  name: 'RGB + Mask + Depth',
  key: 'rgb_mask_depth',
  roles: ['rgb', 'mask', 'depth'],
  matcher: combinedMatcher(
    nameSuffixMatcher(['rgb', 'mask', 'depth'], {
      rgb: { suffixes: [''], extensions: IMAGE_EXTS },
      mask: { suffixes: ['_mask'], extensions: IMAGE_EXTS },
      depth: { suffixes: ['_depth'], extensions: IMAGE_EXTS },
    }),
    siblingDirMatcher(['rgb', 'mask', 'depth'], {
      rgb: ['rgb', 'color', 'image', 'images'],
      mask: ['mask', 'masks', 'seg', 'segmentation'],
      depth: ['depth', 'depths', 'depth_map'],
    })
  ),
  component: RgbMaskDepthViewer,
});

// RGB + JSON
registerTuple({
  name: 'RGB + JSON',
  key: 'rgb_json',
  roles: ['rgb', 'json'],
  matcher: combinedMatcher(
    sameNameMatcher(['rgb', 'json'], {
      rgb: IMAGE_EXTS,
      json: ['.json'],
    }),
    nameSuffixMatcher(['rgb', 'json'], {
      rgb: { suffixes: [''], extensions: IMAGE_EXTS },
      json: { suffixes: ['', '_anno', '_annotation'], extensions: ['.json'] },
    })
  ),
  component: RgbJsonViewer,
});
