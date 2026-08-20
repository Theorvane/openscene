import AVFoundation

/**
 The shape of a sound, as one number per bar.

 Decoded rather than estimated: nothing in a file's metadata says where it is
 loud, so the only way to know where the beat is, is to read the samples. The
 reader is given the clip's own window and folds samples into buckets as they
 arrive, so a long file costs a pass and not a copy of itself in memory.

 Peak rather than average per bucket, because a waveform is drawn to be looked
 at: the loudest moment in a bar is what the eye is looking for, and averaging a
 busy passage flattens it into a wall.

 Best-effort throughout. Anything that will not decode comes back empty and the
 clip is drawn the way it was before waveforms existed. Kept free of
 ExpoModulesCore so the macOS tests can run it, the way the composer is.
 */
public enum AudioPeaks {
  public static func read(uri: String, startMs: Double, endMs: Double, bars: Int) async -> [Double] {
    let wanted = max(1, min(4_000, bars))
    let spanSeconds = (endMs - startMs) / 1_000
    guard spanSeconds > 0, let url = URL(string: uri) ?? URL(string: "file://\(uri)") else { return [] }

    let asset = AVURLAsset(url: url)
    guard let tracks = try? await asset.loadTracks(withMediaType: .audio), let audioTrack = tracks.first else {
      return []
    }

    guard let reader = try? AVAssetReader(asset: asset) else { return [] }
    reader.timeRange = CMTimeRange(
      start: CMTime(seconds: startMs / 1_000, preferredTimescale: 600),
      duration: CMTime(seconds: spanSeconds, preferredTimescale: 600)
    )

    let output = AVAssetReaderTrackOutput(
      track: audioTrack,
      outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsNonInterleaved: false
      ]
    )
    guard reader.canAdd(output) else { return [] }
    reader.add(output)
    guard reader.startReading() else { return [] }

    var peaks = [Double](repeating: 0, count: wanted)
    let startSeconds = startMs / 1_000

    while let sample = output.copyNextSampleBuffer() {
      guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
      var length = 0
      var pointer: UnsafeMutablePointer<Int8>?
      guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer) == noErr,
            let bytes = pointer else { continue }

      /*
       Each sample goes in the bucket its own moment falls in.

       One bucket per buffer put a whole buffer's loudest sample wherever that
       buffer started, so chunks straddling a boundary smeared the tone back
       across the silence — CI read 0.36 in a half that was meant to be silent.
       A sample's moment is its buffer's timestamp plus its offset at the
       sampling rate, and that is what decides where it lands.
       */
      let format = CMSampleBufferGetFormatDescription(sample)
      let basic = format.flatMap { CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee }
      let rate = basic?.mSampleRate ?? 44_100
      let channels = Double(basic?.mChannelsPerFrame ?? 1)
      let bufferStart = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) - startSeconds
      let count = length / MemoryLayout<Int16>.size

      bytes.withMemoryRebound(to: Int16.self, capacity: count) { samples in
        // Every fiftieth sample: a peak does not move meaningfully between
        // neighbours, and reading them all is the difference between a waveform
        // that appears and one that arrives late.
        var index = 0
        while index < count {
          let frame = Double(index) / max(1, channels)
          let position = (bufferStart + frame / rate) / spanSeconds
          if position >= 0, position < 1 {
            let bucket = min(wanted - 1, max(0, Int(position * Double(wanted))))
            let value = abs(Double(samples[index])) / 32_768
            if value > peaks[bucket] { peaks[bucket] = value }
          }
          index += 50
        }
      }
    }

    return reader.status == .failed ? [] : peaks
  }
}
