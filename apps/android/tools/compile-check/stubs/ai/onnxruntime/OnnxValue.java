package ai.onnxruntime;
public interface OnnxValue extends AutoCloseable { Object getValue() throws OrtException; void close(); }
