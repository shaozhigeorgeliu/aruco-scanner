/* Multi-dictionary ArUco detection built on js-aruco2.
 *
 * js-aruco2 decodes against ONE dictionary per Detector. To recognise the
 * library automatically we run the (expensive) image steps once, then try each
 * dictionary on the shared quad candidates.
 */
(function (root) {
  'use strict';
  var AR = root.AR, CV = root.CV;

  // auto:true dictionaries are tried in Auto mode. cvPrefix + sizes give the OpenCV names
  // (the 50/100/250/1000 variants are prefixes of the same code table).
  var DEFS = [
    { name: 'ARUCO_4X4_1000', label: 'ArUco 4×4', auto: true, cvPrefix: 'DICT_4X4', sizes: [50, 100, 250, 1000] },
    { name: 'ARUCO_5X5_1000', label: 'ArUco 5×5', auto: true, cvPrefix: 'DICT_5X5', sizes: [50, 100, 250, 1000] },
    { name: 'ARUCO_6X6_1000', label: 'ArUco 6×6', auto: true, cvPrefix: 'DICT_6X6', sizes: [50, 100, 250, 1000] },
    { name: 'ARUCO_7X7_1000', label: 'ArUco 7×7', auto: true, cvPrefix: 'DICT_7X7', sizes: [50, 100, 250, 1000] },
    { name: 'ARUCO_DEFAULT_OPENCV', label: 'ArUco Original 5×5', auto: true, cvFull: 'DICT_ARUCO_ORIGINAL' },
    { name: 'ARUCO_MIP_36h12', label: 'ArUco MIP 36h12', auto: true },
    { name: 'APRILTAG_16h5', label: 'AprilTag 16h5', auto: true, cvFull: 'DICT_APRILTAG_16h5' },
    { name: 'APRILTAG_25h9', label: 'AprilTag 25h9', auto: true, cvFull: 'DICT_APRILTAG_25h9' },
    { name: 'APRILTAG_36h10', label: 'AprilTag 36h10', auto: true },
    { name: 'APRILTAG_36h11', label: 'AprilTag 36h11', auto: true, cvFull: 'DICT_APRILTAG_36h11' },
    { name: 'ARUCO_DEFAULT', label: 'ArUco (js-aruco default)', auto: false },
    { name: 'ARUCO_MIP_16h3', label: 'ArUco MIP 16h3', auto: false },
    { name: 'ARUCO_MIP_25h7', label: 'ArUco MIP 25h7', auto: false },
    { name: 'APRILTAG_25h7', label: 'AprilTag 25h7', auto: false },
    { name: 'APRILTAG_36h9', label: 'AprilTag 36h9', auto: false },
    { name: 'ARTAG', label: 'ARTag', auto: false },
    { name: 'ARTOOLKITPLUS', label: 'ARToolKitPlus', auto: false },
    { name: 'ARTOOLKITPLUSBCH', label: 'ARToolKitPlus BCH', auto: false }
  ].filter(function (d) { return AR.DICTIONARIES[d.name]; });

  var WARP_CELL = 8; // pixels per grid cell when un-warping a candidate

  function buildDictionary(def) {
    var dict = new AR.Dictionary(def.name);
    // Only correct up to ~60% of the guaranteed error-correction capacity (same as OpenCV),
    // otherwise random squares in the scene decode as phantom tags.
    var maxCorr = Math.max(0, Math.floor(((dict.tau - 1) / 2) * 0.6));
    dict.tau = maxCorr + 1; // Dictionary.find accepts distance < tau
    if (maxCorr === 0) {
      dict.find = function (bits) {
        var s = '';
        for (var i = 0; i < bits.length; i++) s += bits[i].join('');
        var hit = this.codes[s];
        return hit ? { id: hit.id, distance: 0 } : null;
      };
    }
    dict.maxCorr = maxCorr;
    return dict;
  }

  // Probability that random bits would decode as some valid code of `dict` within `distance` bit errors
  // (4 rotations). Small dictionaries like 4x4 match noise far more often than 7x7, so when one square
  // decodes in several dictionaries the least-likely-by-chance reading is the real one.
  function chance(dict, distance) {
    var n = dict.nBits, ways = 0, c = 1;
    for (var d = 0; d <= distance; d++) {
      ways += c;
      c = c * (n - d) / (d + 1);
    }
    return dict.codeList.length * 4 * ways / Math.pow(2, n);
  }

  function create() {
    var det = new AR.Detector({ dictionaryName: DEFS[0].name });
    var built = {};
    DEFS.forEach(function (d) { built[d.name] = { def: d, dict: buildDictionary(d) }; });

    function groupsFor(names) {
      var groups = {};
      names.forEach(function (n) {
        var b = built[n];
        if (!b) return;
        var size = b.dict.markSize;
        (groups[size] = groups[size] || []).push(b);
      });
      return groups;
    }

    // image: {width, height, data(RGBA)}. only: dictionary name or null for all auto dictionaries.
    function scan(image, only) {
      var names = only ? [only] : DEFS.filter(function (d) { return d.auto; }).map(function (d) { return d.name; });
      var groups = groupsFor(names);

      CV.grayscale(image, det.grey);
      CV.adaptiveThreshold(det.grey, det.thres, 2, 7);
      det.contours = CV.findContours(det.thres, det.binary);
      var cands = det.findCandidates(det.contours, image.width * 0.01, 0.05, 10);
      cands = det.clockwiseCorners(cands);
      cands = det.notTooNear(cands, 10);

      var out = [];
      for (var c = 0; c < cands.length; c++) {
        var best = null;
        for (var size in groups) {
          CV.warp(det.grey, det.homography, cands[c], size * WARP_CELL);
          CV.threshold(det.homography, det.homography, CV.otsu(det.homography));
          var list = groups[size];
          for (var k = 0; k < list.length; k++) {
            det.dictionary = list[k].dict;
            var m = det.getMarker(det.homography, cands[c]);
            if (!m) continue;
            var p = chance(list[k].dict, m.hammingDistance);
            if (!best || p < best.chance) {
              best = { dict: list[k].def.name, id: m.id, distance: m.hammingDistance, corners: m.corners, chance: p };
            }
          }
        }
        if (best) out.push(best);
      }
      return out;
    }

    return { scan: scan, defs: DEFS, built: built };
  }

  // "DICT_4X4_50" style name for an ID found in `def`, or the plain label.
  function describe(def, id) {
    if (def.cvPrefix) {
      for (var i = 0; i < def.sizes.length; i++) {
        if (id < def.sizes[i]) return def.cvPrefix + '_' + def.sizes[i];
      }
    }
    return def.cvFull || def.label;
  }

  function area(corners) {
    var a = 0;
    for (var i = 0; i < corners.length; i++) {
      var p = corners[i], q = corners[(i + 1) % corners.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  root.ArucoScanner = { DEFS: DEFS, create: create, describe: describe, area: area };
})(window);
