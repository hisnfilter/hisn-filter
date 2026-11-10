package ai.onnxruntime;
import java.util.*;
public class OrtSession implements AutoCloseable {
  public Set<String> getInputNames() { return null; }
  public Set<String> getOutputNames() { return null; }
  public Result run(Map<String, ? extends OnnxTensorLike> inputs) throws OrtException { return null; }
  public void close() throws OrtException {}
  public static class Result implements AutoCloseable, Iterable<Map.Entry<String, OnnxValue>> {
    public OnnxValue get(int i) { return null; }
    public Optional<OnnxValue> get(String n) { return null; }
    public Iterator<Map.Entry<String, OnnxValue>> iterator() { return null; }
    public void close() {}
  }
  public static class SessionOptions implements AutoCloseable {
    public enum OptLevel { NO_OPT, BASIC_OPT, EXTENDED_OPT, ALL_OPT }
    public void setOptimizationLevel(OptLevel l) throws OrtException {}
    public void setIntraOpNumThreads(int n) throws OrtException {}
    public void addXnnpack(Map<String, String> o) throws OrtException {}
    public void addConfigEntry(String k, String v) throws OrtException {}
    public void close() {}
  }
}
