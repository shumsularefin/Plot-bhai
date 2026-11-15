import ij.IJ;
import ij.ImagePlus;
import ij.measure.Measurements;
import ij.measure.ResultsTable;
import ij.plugin.filter.ParticleAnalyzer;
import ij.process.AutoThresholder;
import ij.process.ImageProcessor;
import java.io.FileWriter;
import java.util.Locale;

/**
 * ImageJ reference for tests/validation-particles.test.ts. Opens the test image written by
 * make_particles.py with ImageJ 1.x itself and writes particles-imagej.json:
 *
 *   thresholds  ij.process.AutoThresholder.getThreshold for each method on the image histogram
 *               (the same code as Image > Adjust > Auto Threshold)
 *   particles   Analyze > Analyze Particles of the pixels above 127 (threshold 128 to 255, all
 *               sizes, 8-connected, holes not included): Area, X, Y, Perim., Major, Minor,
 *               Angle, Circ., Feret, MinFeret, FeretAngle
 *
 * Run headless (ij.jar from Maven Central, net.imagej:ij):
 *   javac -cp ij.jar -d build ImageJCheck.java
 *   java -Djava.awt.headless=true -cp ij.jar:build ImageJCheck particles.pgm particles-imagej.json
 */
public class ImageJCheck {
  public static void main(String[] args) throws Exception {
    Locale.setDefault(Locale.ROOT);
    ImagePlus imp = IJ.openImage(args[0]);
    ImageProcessor ip = imp.getProcessor();
    int[] histogram = ip.getHistogram();
    StringBuilder json = new StringBuilder();
    json.append("{\n \"source\": \"ImageJ ").append(IJ.getVersion()).append(
        "; scripts/validation/particles/ImageJCheck.java\",\n \"thresholds\": {");
    String[] methods = {
      "Default", "Intermodes", "IsoData", "Li", "MaxEntropy", "Mean", "Minimum", "Moments", "Otsu",
      "Triangle"
    };
    AutoThresholder thresholder = new AutoThresholder();
    for (int i = 0; i < methods.length; i++) {
      int level = thresholder.getThreshold(AutoThresholder.Method.valueOf(methods[i]), histogram);
      json.append(i == 0 ? "" : ",").append("\n  \"").append(methods[i]).append("\": ").append(level);
    }
    json.append("\n },\n \"level\": 127,\n \"particles\": [");

    ip.setThreshold(128, 255, ImageProcessor.NO_LUT_UPDATE);
    ResultsTable rt = new ResultsTable();
    int measurements =
        Measurements.AREA
            | Measurements.CENTROID
            | Measurements.PERIMETER
            | Measurements.ELLIPSE
            | Measurements.SHAPE_DESCRIPTORS
            | Measurements.FERET;
    ParticleAnalyzer analyzer =
        new ParticleAnalyzer(ParticleAnalyzer.SHOW_NONE, measurements, rt, 0, Double.POSITIVE_INFINITY);
    analyzer.setHideOutputImage(true);
    analyzer.analyze(imp, ip);
    String[] columns = {
      "Area", "X", "Y", "Perim.", "Major", "Minor", "Angle", "Circ.", "Feret", "MinFeret", "FeretAngle"
    };
    for (int row = 0; row < rt.size(); row++) {
      json.append(row == 0 ? "\n  {" : ",\n  {");
      for (int c = 0; c < columns.length; c++) {
        json.append(c == 0 ? "" : ", ")
            .append('"')
            .append(columns[c])
            .append("\": ")
            .append(rt.getValue(columns[c], row));
      }
      json.append('}');
    }
    json.append("\n ]\n}\n");
    try (FileWriter writer = new FileWriter(args[1])) {
      writer.write(json.toString());
    }
    System.out.println("particles " + rt.size());
  }
}
